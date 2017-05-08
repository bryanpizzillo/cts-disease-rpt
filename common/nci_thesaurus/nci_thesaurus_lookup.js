const _                   = require("lodash");
const async               = require("async");
const Logger              = require("../logger");
const NCIThesaurusTerm    = require("./nci_thesaurus_term");

//THIS IS FOR MOCKING MAIN CANCER TYPES
const MainTypesMock       = require("./main-types.json");

// The NCI Thesaurus code system identifier used for building LexEVS urls.
const CODE_SYSTEM_NAME = 'NCI_Thesaurus';

let logger = new Logger({name: "nci-thesaurus-lookup"});

/**
 * A class for handling lookup to get term information from the NCI Thesaurus using LexEVS CTS2
 * 
 * @class NCIThesaurusLookup
 */
class NCIThesaurusLookup {

  /**
   * Creates an instance of NCIThesaurusLookup.
   * 
   * @param {any} client The LexEVS client to use
   * @param {string} version The version of the NCI Thesaurus to use. Defaults to "17.01e".
   * 
   * @memberOf NCIThesaurusLookup
   */
  constructor(client, version = "17.04d") {
    this.client = client;
    this.codeSystemVersion = version;
    this.termCache = {};
    this.indexCounter = 0;
  }

  /**
   * Gets a term from the NCI thesaurus.  
   * 
   * @param {any} entityID The ID of the entity to lookup.
   * @param {any} done A completion callback (err, term) called upon error or completion of lookup.
   * 
   * @memberOf NCIThesaurusLookup
   */
  getTerm(entityID, done) {

    //Basically, check to see if the term has already been fetched or not
    //and handle accordingly.  This function *currently* is not called asynchronously,
    //so we should not need to worry about locking. (even then, the only thing may be 
    //that we fetch the same term multiple times, but it should not result in error...)

    if (!this.termCache[entityID]) {

      async.waterfall([
        (next) => {
          this.client.readEntity(
            CODE_SYSTEM_NAME,
            this.codeSystemVersion,
            entityID,
            (err, rawObj) => {
              if (err) {
                return next(err);
              }

              if (rawObj) {
                let term = NCIThesaurusTerm.DeserializeFromLexEVS(rawObj);
                //MOCK OF PRIMARY TYPES
                if (MainTypesMock[term.entityID]) {
                  term.isMainType = true;
                }
                return next(null, term);
              } else {
                return next(null, null);
              }
            }
          );
        },
        (term, next) => {
          if (term) {
            //I assume if a term exists that its subjectOf will as well.
            this.client.getSubjectOf(
              CODE_SYSTEM_NAME,
              this.codeSystemVersion,
              entityID,
              (err, rawObj) => {
                if (err) {
                  return next(err);
                }

                term.addLexEVSSubjectOf(rawObj);
                return next(null, term);
              }
            );
          } else {
            return next(null);
          }
        }
      ], (err, term) => {
        if (err) {
          return done(err);
        }

        //Term may be null it is was not found -- that's ok.

        //Store the term in the cache and "return" the term.
        this.termCache[entityID] = term;
        done(null, this.termCache[entityID]);
      })
      

    } else {
      done(null, this.termCache[entityID]);
    }
  }
}

module.exports = NCIThesaurusLookup;