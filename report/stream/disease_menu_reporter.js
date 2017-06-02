const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "supplement-stream" });

//Order from best choice to least best, so order matters
const PARENTS_OF_LAST_RESORT  = [
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
class DiseaseReporter extends Transform {

  constructor(thesaurusLookup) {
    super({ objectMode: true });

    this.thesaurusLookup = thesaurusLookup;

    //Create hashes
    this.diseases = [];

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

  /**
   * Gets all the parents that are a type of Neoplastic Process
   * and are tagged with main parent.
   * 
   * @param {any} term
   * @param {any} done (err, arrayofparents)
   * 
   * @memberOf DiseaseReporter
   */
  _getMainParents(term, done) {

    let mainParents = [];

    async.eachLimit(
      term.parentTermIDs,
      20,
      (parentID, cb) => {
        //Get each immediate parent's term and parents.
        this.thesaurusLookup.getTerm(parentID, (err, parentTerm) => {
          if (err) {
            return cb(err);
          }

          //Check if we are a neoplastic process (or isMainType, in the case of Disease or Disorder)
          if (parentTerm.isSemanticType('Neoplastic Process') || term.isSemanticType("Disease or Syndrome") || parentTerm.isMainType) {
            //This is a neoplastic process, so we are a candidate for being a main type,
            if (parentTerm.isMainType && !_.some(mainParents, ["entityID", parentTerm.entityID])) {
              mainParents.push(parentTerm);
            }

            //and having more parents that could be main types. This would be a recursive Call
            this._getMainParents(parentTerm, (mperr, parentMainParents) => {
              if (mperr) {
                return cb(mperr);
              }

              //This list will be filtered, so we do not need to check semantic types or
              //if isMainType
              parentMainParents.forEach((parentsMainParent) => {
                if (!_.some(mainParents, ["entityID", parentsMainParent.entityID])) {
                  mainParents.push(parentsMainParent);
                }
              });

              setTimeout(() => { cb(); });
            });
          } else {
            //Not a neoplastic process, so move on.
            setTimeout(() => { cb(); });
          }
        })
      },
      (err) => {
        if (err) {
          return done(err);
        }
        return done(null, mainParents);
      }
    );  

  }

  _getNeoplasticProcess(disease, term, done) {

    //Identify Parent/Sub-parent
    //Collect up list of isMainType parents
    this._getMainParents(term, (err, mainParents) => {
      if (err) {
        return done(err);
      }

      let rtnTermInfos = [];

      let rtnTermInfo = {
            termID: disease.nci_thesaurus_concept_id,
            menu: '', //Neoplasm or Stage
            conceptStatus: term.conceptStatus,
            displayName: term.displayName ? term.displayName : term.preferredName,
            parentID: '',
            parentName: ''            
      }

      //Deal with Parents of last resort
      if (mainParents.length > 0) {
                
        let filteredParents = _.differenceBy(mainParents, this.PARENTS_OF_LAST_RESORT_MAP, 'entityID');

        if (filteredParents.length > 0) {
          //Use the best parents
          mainParents = filteredParents;
        } else if (term.isMainType) {
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
      }

      if (term.isMainType) {
        rtnTermInfo.menu = 'Neoplasm';
        rtnTermInfos.push(rtnTermInfo);
        mainParents.forEach((parent) => {
          let termClone = _.clone(rtnTermInfo);
          termClone.parentID = parent.entityID;
          termClone.parentName = parent.displayName ? parent.displayName : parent.preferredName;
          rtnTermInfos.push(termClone);
        });
      } else if (term.hasSubjectOfAssociation("Disease_Is_Stage") || term.hasSubjectOfAssociation("Disease_Is_Grade")) {
        rtnTermInfo.menu = 'Stage or Grade';

        //A stage may belong to one or more "simplified" names.  For example, "Stage X Disease Y AJCC v6" & "Stage X Disease Y AJCC v7"
        //would roll up into a "Stage X Disease Y".  
        
        let stageMenus = term.filterSynonyms('CTRP', 'SY').map(s => s.text);

        if (stageMenus.length == 0) {
          logger.info(`Missing Simple Stage: ${rtnTermInfo.termID}`)
          //LOG NO MENUS
          rtnTermInfo.menu = 'Stage or Grade - NO SIMPLE MENU';
          
          //In the case of a stage without a simplified menu, just use its display name.
          stageMenus = [ rtnTermInfo.displayName ];
        }
        
        if (mainParents.length > 0) {
          //The parents of stages are odd.  Where a subtype may have specific stages should we mix all the stages when a parent
          //is selected?  That may be UI logic that determines all the stages to fetch and which to filter.

          stageMenus.forEach((stg) => {
            rtnTermInfo.displayName = stg; //Swap out simplified name
            //Loop over parents
            mainParents.forEach((parent) => {
              let termClone = _.clone(rtnTermInfo);
              termClone.parentID = parent.entityID;
              termClone.parentName = parent.displayName ? parent.displayName : parent.preferredName;
              rtnTermInfos.push(termClone);
            });
          });
        } else {
          stageMenus.forEach((stg) => {
            let termClone = _.clone(rtnTermInfo);
            termClone.displayName = stg;
            if (rtnTermInfo.menu != 'Stage or Grade - NO SIMPLE MENU') {
              termClone.menu = 'Stage or Grade - NO PARENTS';
            }
            rtnTermInfos.push(termClone);
          });
        }
      } else {
        rtnTermInfo.menu = 'Neoplasm';
        if (mainParents.length > 0) {
          mainParents.forEach((parent) => {
            let termClone = _.clone(rtnTermInfo);
            termClone.parentID = parent.entityID;
            termClone.parentName = parent.displayName ? parent.displayName : parent.preferredName;
            rtnTermInfos.push(termClone);
          });
        } else {
          rtnTermInfo.menu = 'Neoplasm - NO PARENTS';
          rtnTermInfos.push(rtnTermInfo);
        }
      }      

      done(null, rtnTermInfos);
    });
  }

  _getDiseaseInfo(disease, done) {
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

      if (term.isSemanticType("Neoplastic Process") || term.isSemanticType("Disease or Syndrome")) {
        //Call neoplastic process specific code and stop processing this term
        return this._getNeoplasticProcess(disease, term, done);
      } else { 
        if (
          term.isSemanticType("Laboratory or Test Result") || 
          term.isSemanticType("Finding") ||
          term.isSemanticType("Cell or Molecular Dysfunction") ||
          term.isSemanticType("Gene or Genome") ||
          term.isSemanticType("Clinical Attribute")
        ) {
          //Finding...
          let rtnTermInfo = {
            termID: disease.nci_thesaurus_concept_id,
            menu: 'Finding or Abnormality',
            conceptStatus: term.conceptStatus,
            displayName: term.displayName ? term.displayName : term.preferredName,
            parentID: null,
            parentName: null
          };
          rtnTermInfos.push(rtnTermInfo);
        }
        else if (           
          term.isSemanticType("Sign or Symptom") || 
          term.isSemanticType("Mental or Behavioral Dysfunction")
        ) {
          //Side Effect
          let rtnTermInfo = {
            termID: disease.nci_thesaurus_concept_id,
            menu: 'Side Effect',
            conceptStatus: term.conceptStatus,            
            displayName: term.displayName ? term.displayName : term.preferredName,
            parentID: null,
            parentName: null
          };
          rtnTermInfos.push(rtnTermInfo);
        }
        else {        
          let rtnTermInfo = {
            termID: disease.nci_thesaurus_concept_id,
            menu: 'UNKNOWN',
            conceptStatus: term.conceptStatus,
            displayName: term.displayName ? term.displayName : term.preferredName,
            parentID: null,
            parentName: null            
          };
          console.log(`${term.preferredName} (${term.entityID}) is not a known type`);
          console.log(term.semanticTypes);
          rtnTermInfos.push(rtnTermInfo);
        }
        return done(null, rtnTermInfos);
      }
    })
  }

  /**
   * Group up all diseases from the supplied trial
   * @param {*} trial 
   */
  _inventoryDiseases(trial, done) {
    let trial_diseases = [];

    let trialDiseases = _.filter(trial.diseases, ["inclusion_indicator", "TRIAL"]);
    
    async.eachLimit(
      trialDiseases,
      20,
      (disease, next) => {
        //fetch disease
        this._getDiseaseInfo(disease, (err, diseaseInfos) => {
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
          diseaseInfos.forEach((diseaseInfo) => {
            this.diseases.push([
              trial.nci_id, 
              diseaseInfo.menu,
              diseaseInfo.termID,              
              diseaseInfo.conceptStatus,
              diseaseInfo.displayName,
              diseaseInfo.parentID,
              diseaseInfo.parentName
            ]);
          });
          setTimeout(() => { next(); });
        })
      },
      done
    );
  }

  _transform(trial, enc, next) {

    logger.info(`Disease reporting for trial with nci_id (${trial.nci_id})...`);

    this._inventoryDiseases(trial, (err, res) => {
      this.push(trial);
      next(err);
    });

  }

}

module.exports = DiseaseReporter;
