const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "supplement-stream" });

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
  _findNonStageParents(term, depth, done) {

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

              parents.push(
                {
                  depth: depth,
                  parentTerm: parentTerm
                }
              );
              depth = depth + 1;
            }

            //add all other parents, take this elevator up to the root.
            this._findNonStageParents(parentTerm, depth, (mperr, ancestors) => {
              if (mperr) {
                return cb(mperr);
              }

              //This list will be filtered not containing any stages
              ancestors.forEach((ancestor) => {
                if (!_.some(parents, ["entityID", ancestor.parentTerm.entityID])) {
                  //ASSUMPTION: A stage would always roll up to a cancer type, and then
                  //it is that type that can live multiple places in the tree.  I.E. We should
                  //never have an existing term at a different level of the tree for anything that
                  //is a depth of 1.  Past the initial type, other parents could live at diffent 
                  //depths.
                  parents.push(ancestor);
                }
              });

              setTimeout(() => { cb(); });
            });

          }
        })
      },
      (err) => {
        if (err) {
          return done(err);
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
      (next) => { this._getMainParents(term, next) },
      //Determine what our parents are.
      (mainParents, next) => {

        if (mainParents.length > 0) {
          //Get list of parents with parents of last resort removed.  Parents of last resort should not
          //have stages displayed.
          let filteredParents = _.differenceBy(mainParents, this.PARENTS_OF_LAST_RESORT_MAP, 'entityID');

          if (filteredParents.length > 0) {
            //We have a good list of parents.  Of course, these could be primary.
            next(null, filteredParents);
          } else {
            //Here we have a stage that has a parent, but it is a parent of last resort and should not appear in
            //that menu.  We need to find the all the immediate neoplastic processes that are under the main
            //parents. (As a term can have multiple parents, it could follow multiple paths.)  Add those terms if
            //they are not already a disease on the trial, then use those new terms as the parents of this stage.
            
            //FOR TESTING, just set parents to none.
            next(null, []);
          }
        } else {
          //So there is no parent, not even one that is a last resort.  We could add the immediate neoplastic processes
          //as Neoplasm - No Parent for reporting.  Treat it as stage no parents for now.
          next(null, []);
        }
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

  _getDiseaseInfo(disease, trialDiseases, done) {
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

        if (term.hasSubjectOfAssociation("Disease_Is_Stage") || term.hasSubjectOfAssociation("Disease_Is_Grade")) {
          return this._getStage(disease, term, trialDiseases, done);
        } else {
          return this._getNeoplasticProcess(disease, term, done);
        }

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
        this._getDiseaseInfo(disease, trialDiseases, (err, diseaseInfos) => {
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
