const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "supplement-stream" });

/**
 * Remaps old coded diseases for the purposes of menu reporting
 *
 * @class RemapDiseasesStream
 * @extends {Transform}
 */
class RemapDiseasesStream extends Transform {

  constructor(thesaurusLookup, olddiseases) {
    super({ objectMode: true });

    this.thesaurusLookup = thesaurusLookup;
    this._createOldDiseaseLookups(olddiseases);

    //Create hashes
    this.diseases = [];
  }

  _createOldDiseaseLookups(olddiseases) {
    let oldDiseaseById = {};
    olddiseases.forEach((row) => {
        //"old_code", "old_label", "new_code", "new_label"
        oldDiseaseById[row.old_code] = {
          "old_code": row.old_code,
          "old_label": row.old_label, 
          "new_code": row.new_code, 
          "new_label": row.new_label
        };
    });
    this.oldDiseaseById = oldDiseaseById;
  }

  _remapDisease(disease, done) {

    let fetchID = disease.nci_thesaurus_concept_id;
    let oldid = false;

    if (this.oldDiseaseById[disease.nci_thesaurus_concept_id]) {
      oldid = disease.nci_thesaurus_concept_id;
      fetchID = this.oldDiseaseById[oldid].new_code;
    }
    
    this.thesaurusLookup.getTerm(fetchID, (err, term) => {
      if (err) {
        return done(err);
      }

      if (term) {

        //No term has parents.  Get them. This runs for every term
        disease.parents = term.parentTermIDs;

        // this only happens for terms we need to remap
        if (oldid) {
          logger.info(`Replacing ${this.oldDiseaseById[oldid].old_label} with ${this.oldDiseaseById[oldid].new_label}`);

          disease.disease_code = null;
          disease.lead_disease_indicator = null;
          disease.nci_thesaurus_concept_id = term.entityID;
          disease.disease_preferred_name = term.preferredName;
          disease.disease_menu_display_name = term.displayName ? term.displayName : term.preferredName;
        }
      } else {
        logger.warning(`Term could not be found for ${fetchID}`);
        disease.parents = [];
      }

      done();
    });
  }

  /**
   * Gets all the parents
   * 
   * @param {any} term
   * @param {any} done (err, arrayofparents)
   * 
   * @memberOf DiseaseReporter
   */
  _getMainParents(term, done) {

    let mainParents = [];

    let parentList = null;

    if (term.nci_thesaurus_concept_id) {
      //trial disease
      parentList = term.parents;
    } else {
      //NCIThesaurusTerm
      parentList = term.parentTermIDs;
    }

    async.eachLimit(
      parentList,
      5,
      (parentID, cb) => {
        //Get each immediate parent's term and parents.
        this.thesaurusLookup.getTerm(parentID, (err, parentTerm) => {
          if (err) {
            return cb(err);
          }

          mainParents.push(parentTerm);

          //and having more parents that could be types. This would be a recursive Call
          this._getMainParents(parentTerm, (mperr, parentMainParents) => {
            if (mperr) {
              return cb(mperr);
            }

            //Add parents making sure the parents are unique
            parentMainParents.forEach((parentsMainParent) => {
              if (!_.some(mainParents, ["entityID", parentsMainParent.entityID])) {
                mainParents.push(parentsMainParent);
              }
            });

            //This is a setTimeout call so we don't get a stack overflow
            setTimeout(() => { cb(); });
          });
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

  /**
   * 
   * Gets all parent terms of all trial diseases
   * 
   * @param {any} trial
   * @param {any} done
   * 
   * @memberOf RemapDiseasesStream
   */
  _getAllDiseaseParents(trial, done) {
    logger.info(`Getting all parents for ${trial.nci_id}`);

    let parents = [];

    //Loop over all diseases adding their parents to our parents list.
    async.eachLimit(
      trial.diseases,
      10,
      (disease, cb) => {
        this._getMainParents(disease, (err, parentList) => {
          if (err) {
            return cb(err);
          }

          parentList.forEach((parentTerm) => {
            if (!_.some(parents, (p) => p.entityID == parentTerm.entityID)) {
              parents.push(parentTerm);
            }
          });

          //This is a setTimeout call so we don't get a stack overflow
          setTimeout(() => { cb(); });
        })
      },
      (err) => {
        if (err) {
          return done(err);
        }
        done(null, parents);
      }
    );
  }


  /**
   * Map the diseases from the old terms to the new terms, including tree codes.
   * This will help visualize what a future menu would look like based on trials.
   * 
   * @memberOf RemapDiseasesStream
   */
  _remapDiseases(trial, done) {
    
    logger.info(`${trial.nci_id}: Count before ${trial.diseases.length}`);

    async.waterfall([
      //Step 1. Delete tree codes
      (next) => {
        _.remove(trial.diseases, (disease) => disease.inclusion_indicator == "TREE");
        return next();
      },
      //Step 2. Remap Trial Diseases & get parent codes for all.
      (next) => {
        async.eachLimit(
          trial.diseases,
          10,
          this._remapDisease.bind(this),
          next
        )
      },
      //Step 3. Get all parents for trial diseases
      (next) => { this._getAllDiseaseParents(trial, next); },
      //Step 4. Add back in all parents
      (parents, next) => {
        parents.forEach((parent) => {
            if (!_.some(trial.diseases, (d) => d.nci_thesaurus_concept_id == parent.entityID)) {
              trial.diseases.push({
                disease_code: null,
                lead_disease_indicator: null,
                inclusion_indicator: "TREE",
                nci_thesaurus_concept_id: parent.entityID,
                disease_preferred_name: parent.preferredName,
                disease_menu_display_name: parent.displayName ? parent.displayName : parent.preferredName,
                parents: parent.parentTermIDs
              });
            }
        })
        return next();
      }
    ],
    //Finally
    (err)=> {
      if (err) {
        return done(err);
      }
      logger.info(`${trial.nci_id}: Count after ${trial.diseases.length}`);
      done();
    })
  }

  _transform(trial, enc, next) {

    logger.info(`Disease remapping for trial with nci_id (${trial.nci_id})...`);

    this._remapDiseases(trial, (err, res) => {
      this.push(trial);
      next(err);
    });

  }

}

module.exports = RemapDiseasesStream;
