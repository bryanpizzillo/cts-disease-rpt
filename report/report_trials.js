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

//const CleanseStream       = require("./stream/cleanse.js");
//const CsvStream           = require("./stream/csv.js");
//const GeoCodingStream     = require("./stream/geo_coding.js");
const SpecialCharsStream    = require("./stream/special_chars.js");
const DiseaseReporter       = require("./stream/disease_reporter");
const TrialIDReporter       = require("./stream/trialid_reporter");
const TrialDiseaseReporter  = require("./stream/trial_disease_reporter");
const DiseaseMenuReporter  = require("./stream/disease_menu_reporter");

let logger = new Logger({ name: "report-trials" });

const THESAURUS_FILEPATH = "../../data/Thesaurus.txt";
const NEOPLASM_CORE_FILEPATH = "../../data/Neoplasm_Core.csv";
const DISEASE_BLACKLIST_FILEPATH = "disease_blacklist.csv";
const TRIALS_FILEPATH = "Development/cts-data/trials.out";
const SPECIAL_CHARS_REMOVED_EXT = ".01.chars_removed";
const DISEASES_EXT = ".diseases_list";
const SUPPLEMENTED_EXT = ".02.supplemented";
const CLEANSED_EXT = ".03.cleansed";



class TrialsReporter {

  constructor() {
    let client = new LexEVSClient();
    this.thesaurusLookup = new NCIThesaurusLookup(client, "17.04d");
  }

  /**
   * Removes odd unicode characters from trials output
   * 
   * @param {any} callback
   * 
   * @memberOf TrialsReporter
   */
  _removeSpecialChars(callback) {
    logger.info(`Removing special chars from ${TRIALS_FILEPATH}...`);
    
    let rs = fs.createReadStream(path.join(os.homedir(), TRIALS_FILEPATH));
    let ss = new SpecialCharsStream();
    let ws = fs.createWriteStream(path.join(os.homedir(), TRIALS_FILEPATH + SPECIAL_CHARS_REMOVED_EXT));

    rs.on("error", (err) => { logger.error(err); })
      .pipe(ss)
      .on("error", (err) => { logger.error(err); })
      .pipe(ws)
      .on("error", (err) => { logger.error(err); })
      .on("finish", callback);
  }

  _reportTrials(callback) {
    logger.info("Running reports trials...");
    let rs = fs.createReadStream(path.join(os.homedir(), TRIALS_FILEPATH + SPECIAL_CHARS_REMOVED_EXT));
    let ls = byline.createStream();
    let ts = new DiseaseReporter();
    let tdr = new TrialDiseaseReporter();
    let rt = new TrialIDReporter();
    let dmr = new DiseaseMenuReporter(this.thesaurusLookup);
    //let gs = new GeoCodingStream();
    let jw = JSONStream.stringify();
    let ws = fs.createWriteStream(path.join(os.homedir(), TRIALS_FILEPATH + SUPPLEMENTED_EXT));

    rs.on("error", (err) => { logger.error(err); })
      .pipe(ls)
      .on("error", (err) => { logger.error(err); })
      .pipe(dmr)
      .on("error", (err) => { logger.error(err); })
      //.pipe(gs)
      //.on("error", (err) => { logger.error(err); })
      .pipe(jw)
      .on("error", (err) => { logger.error(err); })
      .pipe(ws)
      .on("error", (err) => { logger.error(err); })
      .on("finish", (err, res) => { 

        this._outputDiseaseMenus(dmr, () => {
          callback();
        });
        /*
        fs.writeFile(
          path.join(os.homedir(), TRIALS_FILEPATH + "trialdiseases"), 
          JSON.stringify(trialdiseases.map((td) => td.join('|')), null, '\t'),
          (err) => {
            callback(err, res);
          }
        );
        */        
      });
  }

  _outputDiseaseMenus(dmr, callback) {
      logger.info("Outputting disease menus...");

      //Get Diseases
      let trialdiseases = dmr.getReportedDiseases();
      
      let stream = fs.createWriteStream(path.join(os.homedir(), TRIALS_FILEPATH + "menudiseases"));

      trialdiseases.forEach((diseaseInfo) => {
        stream.write(diseaseInfo.join("|") + "\n");
      });

      stream.end(null, null, () => {
        
        this._outputFlatDiseaseMenus(dmr, ()=>{
          callback();
        })
      });
  }

  _outputFlatDiseaseMenus(dmr, callback) {
      logger.info("Outputting flattened disease menus...");

      //Get Diseases
      let trialdiseases = dmr.getReportedDiseases();
      
      let stream = fs.createWriteStream(path.join(os.homedir(), TRIALS_FILEPATH + "fltmenudiseases"));

      let grouped = _.groupBy(trialdiseases, disease => disease[4] != '' ? (disease[4] + '/' + disease[1]) : disease[1]);

      _.each(grouped, (diseaseGroup, termID) => { //Note, diseaseGroup,termID is value,key
          //Assume disease Group always has at least one element

          let diseaseInfo = [
            diseaseGroup[0][1],
            diseaseGroup[0][2],
            diseaseGroup[0][3],
            diseaseGroup[0][4],
            diseaseGroup[0][5],
            diseaseGroup.map(disease => disease[0]).join(',')
          ];
          
          stream.write(diseaseInfo.join("|") + "\n");
        });

      stream.end(null, null, () => {
        callback();
      });    
  }

  static run() {
    logger.info("Started transforming trials.json.");
    let trialsReporter = new this();
    async.waterfall([
      (next) => { trialsReporter._removeSpecialChars(next); },
      //(next) => { trialsTransformer._loadThesaurus(next); },
      //(next) => { trialsTransformer._loadNeoplasmCore(next); },
      //(next) => { trialsTransformer._loadDiseaseBlacklist(next); },
      (next) => { trialsReporter._reportTrials(next); },
      //(next) => { trialsTransformer._loadTerms(next); },
      //(next) => { trialsTransformer._cleanseTrials(next); }
    ], (err) => {
      if (err) { logger.error(err); }

      logger.info("Finished reporting trials.json.");
    });
  }

}

TrialsReporter.run();