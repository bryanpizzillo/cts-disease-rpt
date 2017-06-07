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
class StageMenuReporter extends Transform {

  constructor(thesaurusLookup, diseases, stages) {
    super({ objectMode: true });

    this.thesaurusLookup = thesaurusLookup;

    //Create hashes
    this.diseases = diseases;

    //Pull out menus
    this.menuItems = this._getCancerMenuItems(this.diseases);

    this.stages = stages;

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

  /**
   * Gets all non-stage parents
   * @param {*} term The term to get non-stage parents for
   * @param {*} depth The current term depth.  Only includes depth of non-stage terms.
   * @param {*} done 
   */
  _findNonStageParents(term, done) {
    let parents = [];

    async.eachLimit(
      term.parentTermIDs,
      20,
      (parentID, cb) => {        
        //Get each immediate parent's term and parents.
        this.thesaurusLookup.getTerm(parentID, (err, parentTerm) => {

          if (err) {
            return cb(err);
          }

          //Only add it to our parents list if it is not a stage.
          if (!term.hasSubjectOfAssociation("Disease_Is_Stage") && !term.hasSubjectOfAssociation("Disease_Is_Grade")) {
            if (!_.some(parents, ["entityID", parentTerm.entityID])) {
              parents.push(parentTerm);
            }
          }
     
          //add all other parents, take this elevator up to the root.
          this._findNonStageParents(parentTerm, (mperr, ancestors) => {
            if (mperr) {
              return cb(mperr);
            }

            //This list will be filtered not containing any stages
            ancestors.forEach((ancestor) => {
              if (!_.some(parents, ["entityID", ancestor.entityID])) {
                //ASSUMPTION: A stage would always roll up to a cancer type, and then
                //it is that type that can live multiple places in the tree.  I.E. We should
                //never have an existing term at a different level of the tree for anything that
                //is a depth of 1.  Past the initial type, other parents could live at diffent 
                //depths.
                parents.push(ancestor);
              }
            });

            setTimeout(() => { cb(null,null); });
          });

        })
      },
      (err) => {
        if (err) {
          return done(err, null);
        }
        return done(null, parents);
      }
    );  

  }

  /**
   * 
   * @param {*} disease 
   * @param {*} term 
   * @param {*} done 
   */
  _getStage(disease, term, trialDiseases, done) {


    let rtnTermInfos = [];

    let rtnTermInfo = {
          termID: disease.nci_thesaurus_concept_id,
          menu: 'Stage or Grade', //Neoplasm or Stage
          conceptStatus: term.conceptStatus,
          displayName: term.displayName ? term.displayName : term.preferredName,
          parentID: '',
          parentName: ''            
    }
    
    async.waterfall([
      //Get all main parents
      (next) => { 
        this._findNonStageParents(term, next) 
      },
      //Determine what our parents are.
      (parents, next) => {
        let menuParents = []

        //TODO: Remove Parents of Last Resort.
        parents = _.differenceBy(parents, this.PARENTS_OF_LAST_RESORT_MAP, 'entityID');

        //Find appropriate menu items
        parents.forEach(p => {
          //Only use parents that are either a Primary Type or a Sub-Type.
          if (this.menuItems[p.entityID]){
            if (!_.some(menuParents, ['entityID', p.entityID])) {
              menuParents.push(p);
            }
          }
        })

        next(null, menuParents);
      },
      (mainParents, next) => {
        //We have the correct filtered list of main parents, so no need to deal with that.
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

            termClone.menu = 'Stage or Grade - NO PARENTS';

            rtnTermInfos.push(termClone);
          });
        }

        next(null, rtnTermInfos);        
      }
    ], done);
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
        mainParents = this._filterDiseaseParents(mainParents, term.isMainType);
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

  _getStageInfo(disease, trialDiseases, done) {
  
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

      if (term.hasSubjectOfAssociation("Disease_Is_Stage") || term.hasSubjectOfAssociation("Disease_Is_Grade")) {        
        return this._getStage(disease, term, trialDiseases, done);
      } else {
        return done(null, []);
      }
    });
  }

  /**
   * Group up all diseases from the supplied trial
   * @param {*} trial 
   */
  _inventoryStages(trial, done) {
    let trial_diseases = [];

    let trialDiseases = _.filter(trial.diseases, ["inclusion_indicator", "TRIAL"]);
    
    async.eachLimit(
      trialDiseases,
      20,
      (disease, next) => {
        //fetch disease
        this._getStageInfo(disease, trialDiseases, (err, stageInfos) => {
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
          stageInfos.forEach((stageInfo) => {
            this.stages.push([
              trial.nci_id, 
              stageInfo.menu,
              stageInfo.termID,              
              stageInfo.conceptStatus,
              stageInfo.displayName,
              stageInfo.parentID,
              stageInfo.parentName
            ]);
          });
          setTimeout(() => { next(); });
        })
      },
      done
    );
  }

  _transform(trial, enc, next) {

    logger.info(`Stage reporting for trial with nci_id (${trial.nci_id})...`);

    this._inventoryStages(trial, (err, res) => {
      this.push(trial);
      next(err);
    });

  }

}

module.exports = StageMenuReporter;
