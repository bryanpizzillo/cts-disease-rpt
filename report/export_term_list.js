const fs                  = require("fs");
const path                = require("path");
const async               = require("async");
const _                   = require("lodash");
const byline              = require('byline');
const JSONStream          = require("JSONStream");
const os                  = require("os");

const Logger              = require("../common/logger");

const NCIThesaurusLookup  = require("../common/nci_thesaurus/nci_thesaurus_lookup");
const LexEVSClient        = require("../common/nci_thesaurus/lexevs_client");

let logger = new Logger({ name: "export-term-list" });
const ROOT_TERMS = ['C7057', 'C1908']

/**
 * 
 * Exports a map of terms from EVS
 * 
 * @class ExportTermList
 */
class ExportTermList {

  constructor() {
    let client = new LexEVSClient();
    this.thesaurusLookup = new NCIThesaurusLookup(client, "17.04d");
    this.encounteredTerms = {};
  }

  _getAndPrintTerms(depth, termID, done) {
    if (this.encounteredTerms[termID]) {
      return done();
    }

    this.thesaurusLookup.getTerm(termID, (err, term) => {
      if (err) {
        return done(err);
      }

      if (!term) {
        logger.error(`Missing Term ${termID}`);
        this.encounteredTerms[termID] = true;
        return done();
      }

      //Output term
      let mapInfo = [
        termID,
        term.displayName ? term.displayName : term.preferredName
      ];

      //logger.info("Fetched: " + mapInfo.join("|"));
      this.stream.write(mapInfo.join("|") + "\n");
      this.encounteredTerms[termID] = true;

      //Handle Children
      let nextDepth = depth + 1;

      async.eachLimit(
        _.filter(term.children, t => t.id.startsWith("C")).map(t => t.id),
        3,
        this._getAndPrintTerms.bind(this, nextDepth),
        (err) => {
          if (err) {
            return done(err);
          }
          //So we don't overflow the stack
          if (depth == 1) {
            done();
          } else {
            setTimeout(() => { done(); });
          }
        }
      );
    });
  }

  _generateTermList() {
    return new Promise((resolve, reject) => {
      this.stream = fs.createWriteStream(path.join(__dirname, "termdump.txt"));

      async.eachLimit(
        ROOT_TERMS,
        1,
        this._getAndPrintTerms.bind(this, 1),
        (err) => {
          if (err) {
            this.stream.end(null, null, () => {
              reject(err);
            });
          } else {
            this.stream.end(null, null, () => {
              resolve(err);
            });            
          }
        }
      )


    });
  }

  static run() {
    logger.info("Started export Term List.");
    let exportTermList = new this();

    exportTermList._generateTermList()
      .then(()=> {
        logger.info("Finished reporting trials.json.");
      })
      .catch((err) => {
        logger.error(err);
      })
  }
}

ExportTermList.run();