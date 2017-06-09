const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "stage-menu-stream" });

//Order from best choice to least best, so order matters
const PARENTS_OF_LAST_RESORT  = [
  //Germ Cell Tumor
  'C3708',
  //Glioma
  'C3059',
  //Lymphoma
  'C3208',
  //Neuroendocrine Tumor
  'C3809',
  //Sarcoma
  'C9118',
  //Carcinoma
  'C2916',
  //Neoplasm by Special Category
  'C7062',
  //Neoplasm by Site
  'C3263',  
  //Neoplasm by Morphology
  'C4741',
  //Disease or Disorder
  'C2991'
];

/**
 * Supplements trials by adding appropriate NCIt values and other terms
 *
 * @class TransformStream
 * @extends {Transform}
 */
class FindingsMenuReporter extends Transform {

  constructor(thesaurusLookup, diseases, stages, findings) {
    super({ objectMode: true });

    this.thesaurusLookup = thesaurusLookup;

    //Create hashes
    this.diseases = diseases;

    //Pull out menus
    this.menuItems = this._getCancerMenuItems(this.diseases);

    this.stages = stages;

    this.findings = findings;

    //So we build the map once and do not have to iterate over the array
    //each time we want to use it.
    this.PARENTS_OF_LAST_RESORT_MAP = PARENTS_OF_LAST_RESORT.map(p => {
      return {
        entityID: p
      }
    });

  }

  getReportedDiseases() {
      return this.diseases;
  }

  _getCancerMenuItems(diseases) {

    let rtnMenuItems = {};

    //Makes multi dim array
    let grouped = _.groupBy(diseases, disease => disease[5] != '' ? (disease[5] + '/' + disease[2]) : disease[2]);
    let uniqDiseases = [];

    _.each(grouped, (diseaseGroup, termID) => { //Note, diseaseGroup,termID is value,key
      //Assume disease Group always has at least one element

      let diseaseInfo = { 
        "menu": diseaseGroup[0][1],
        "termID": diseaseGroup[0][2],
        //No Status
        "displayName": diseaseGroup[0][4],
        "parentID": diseaseGroup[0][5],
        "parentName": diseaseGroup[0][6]
        //No Trial IDs
      };
      
      uniqDiseases.push(diseaseInfo);
    });

    //These are the items with no parent since the trial was tagged against
    //a top level parent.
    let directlyIndexedParents = _(uniqDiseases)
      .filter(mi => (mi.menu == "Neoplasm" && mi.parentID == ''))
      .value()
      .map(mi => {
        return {
          termID: mi.termID,
          displayName: mi.displayName
        }
      });

    //These are the menu items with parents where the trials where tagged against a child,      
    let parentsForIndexedChildren = _(uniqDiseases)
      .filter(mi => (mi.menu == "Neoplasm" && mi.parentID != ''))
      .value()
      .map(mi => {
        return {
          termID: mi.parentID,
          displayName: mi.parentName
        }
      });

    //Combine the two
    let parents = _.unionBy(directlyIndexedParents, parentsForIndexedChildren, 'termID');
    parents = _.sortBy(parents, 'displayName');

    //Add Primary Menu Items to our List of Menus
    let rootMenu = _.unionBy(parents, 'termID')
      .map(mi => {
        return {
          "displayName": mi.displayName,
          "entityID": mi.termID
        }
      })
      .forEach(mi => {
        rtnMenuItems[mi.entityID] = mi;
      });


    let groupedMenus = _(uniqDiseases)
      .filter(mi => { return (mi.menu == "Neoplasm" && mi.parentID != '')} )
      .map(mi => {
        return {
          "displayName": mi.displayName,
          "entityID": mi.termID
        }        
      })
      .uniqBy('entityID')
      .value()
      .forEach(mi => {
        if (!rtnMenuItems[mi.entityID]) {
          rtnMenuItems[mi.entityID] = mi;
        }
      });;

      return rtnMenuItems;
  }


  _filterDiseaseParents(mainParents, isMainType) {
    let filteredParents = _.differenceBy(mainParents, this.PARENTS_OF_LAST_RESORT_MAP, 'entityID');

    if (filteredParents.length > 0) {
      //Use the best parents
      mainParents = filteredParents;
    } else if (isMainType) {
      //No non-PLR parents, but we are a menu item so no need for PLRs
      mainParents = [];
    } else { 
      //Use the best Parent of last resort.  
      //to put this in a PLR.  
      //We are guaranteed to have at least one PLR if we are in this block.  We find the PLRs
      //in use maintaining order, then set mainParents equal to the term that term. 
      let usedPLR = _.intersectionBy(this.PARENTS_OF_LAST_RESORT_MAP, mainParents, 'entityID')[0];
      mainParents = [ _.find(mainParents, ["entityID", usedPLR.entityID]) ];
    }

    return mainParents;
  }

  _getFindingOrSideEffect(type, disease, term, trialDiseases, done) {
    let rtnTermInfos = [];

    let rtnTermInfo = {
          termID: disease.nci_thesaurus_concept_id,
          menu: type, //Neoplasm or Stage
          conceptStatus: term.conceptStatus,
          displayName: term.displayName ? term.displayName : term.preferredName,
          parentID: '',
          parentName: ''            
    }

    trialDiseases.forEach(td => {
      let mi = this.menuItems[td.nci_thesaurus_concept_id];

      if (mi && !_.some(rtnTermInfo, ['parentID', mi.entityID])) {
        //Push in the fragments of a NCIThesaurus term that we look for.
          let termClone = _.clone(rtnTermInfo);
          termClone.parentID = mi.entityID;
          termClone.parentName = mi.displayName;
          rtnTermInfos.push(termClone);
      }
    })

    done(null, rtnTermInfos);
  }



  _getFindingInfo(disease, trialDiseases, done) {
  
    this.thesaurusLookup.getTerm(disease.nci_thesaurus_concept_id, (err, term) => {
      if (err) {
        return done(err);
      }

      let rtnTermInfos = [];
      
      if (!term) {
        rtnTermInfos.push({
          termID: disease.nci_thesaurus_concept_id,
          menu: "!!MISSING!!",
          displayName: '',
          parentID: '',
          parentName: ''
        });
        return done(null, rtnTermInfos);
      }

      if (term.conceptStatus == "Obsolete_Concept" || term.conceptStatus == "Retired_Concept") {
        logger.info(`Skipping Obsolete or Retired Term (${term.entityID}) ${term.preferredName}`);
        return done(null, []);
      }      

      if (
        term.isSemanticType("Laboratory or Test Result") || 
        term.isSemanticType("Finding") ||
        term.isSemanticType("Cell or Molecular Dysfunction") ||
        term.isSemanticType("Gene or Genome") ||
        term.isSemanticType("Clinical Attribute")
      ) {
        return this._getFindingOrSideEffect('Finding or Abnormality', disease, term, trialDiseases, done);
      }
      else if (           
        term.isSemanticType("Sign or Symptom") || 
        term.isSemanticType("Mental or Behavioral Dysfunction")
      ) {
        return this._getFindingOrSideEffect('Side Effect', disease, term, trialDiseases, done);
      } else {
        return done(null, []);
      }
    });
  }

  /**
   * Group up all diseases from the supplied trial
   * @param {*} trial 
   */
  _inventoryFindings(trial, done) {
    let trial_diseases = [];

    let trialDiseases = _.filter(trial.diseases, ["inclusion_indicator", "TRIAL"]);
    
    async.eachLimit(
      trialDiseases,
      20,
      (disease, next) => {
        //fetch disease -- Note we look at all the trial diseases including tree codes which finding menus
        this._getFindingInfo(disease, trial.diseases, (err, findingInfos) => {
          if (err) {
            return next(err);
          }
/*
        termID: disease.nci_thesaurus_concept_id,
        termType: '',
        primary: '',
        secondary: '',
        stage_or_grade: '',
        finding_or_abnormality: '',
        side_effect: '',
        unknown: ''
*/
          //push info
          findingInfos.forEach((findingInfo) => {
            this.findings.push([
              trial.nci_id, 
              findingInfo.menu,
              findingInfo.termID,              
              findingInfo.conceptStatus,
              findingInfo.displayName,
              findingInfo.parentID,
              findingInfo.parentName
            ]);
          });
          setTimeout(() => { next(); });
        })
      },
      done
    );
  }

  _transform(trial, enc, next) {

    logger.info(`Finding reporting for trial with nci_id (${trial.nci_id})...`);

    this._inventoryFindings(trial, (err, res) => {
      this.push(trial);
      next(err);
    });

  }

}

module.exports = FindingsMenuReporter;
