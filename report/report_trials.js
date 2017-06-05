const fs                  = require("fs");
const path                = require("path");
const async               = require("async");
const moment              = require('moment');
const _                   = require("lodash");
const byline              = require('byline');
const JSONStream          = require("JSONStream");
const os                  = require("os");

const Logger              = require("../common/logger");

const NCIThesaurusLookup  = require("../common/nci_thesaurus/nci_thesaurus_lookup");
const LexEVSClient        = require("../common/nci_thesaurus/lexevs_client");

//const CleanseStream       = require("./stream/cleanse.js");
const CsvStream           = require("./stream/csv.js");
//const GeoCodingStream     = require("./stream/geo_coding.js");
const SpecialCharsStream    = require("./stream/special_chars.js");
const ExtractTrialStream    = require("./stream/extract_trial");
const RemapDiseasesStream    = require("./stream/remap_diseases");
const DiseaseReporter       = require("./stream/disease_reporter");
const TrialIDReporter       = require("./stream/trialid_reporter");
const TrialDiseaseReporter  = require("./stream/trial_disease_reporter");
const DiseaseMenuReporter  = require("./stream/disease_menu_reporter");

let logger = new Logger({ name: "report-trials" });

const OLDDISEASES_FILEPATH = "Development/cts-data/old_disease_mappings.txt";
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
    let client = new LexEVSClient(path.join(os.homedir(), TRIALS_FILEPATH.replace("trials.out", "evs_cache")));
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

  _loadOldDiseaseMap(callback) {
    logger.info("Loading the old disease mappings...");
    let header = [
      "old_code", "old_label", "new_code", "new_label"
    ];
    let delimiter = "|";
    let exclude = []
    this.old_diseases = [];

    let rs = fs.createReadStream(path.join(os.homedir(), OLDDISEASES_FILEPATH));
    let ls = byline.createStream();
    let cs = new CsvStream({header, delimiter, exclude});

    rs.on("error", (err) => { logger.error(err); })
      .pipe(ls)
      .on("error", (err) => { logger.error(err); })
      .pipe(cs)
      .on("error", (err) => { logger.error(err); })
      .on("data", (jsonRow) => {
        this.old_diseases.push(jsonRow);
      })
      .on("finish", () => {
        logger.info(`Loaded ${this.old_diseases.length} terms from the old disease mappings.`);
        return callback();
      });
  }

  _reportTrials(callback) {
    logger.info("Running reports trials...");
    let rs = fs.createReadStream(path.join(os.homedir(), TRIALS_FILEPATH + SPECIAL_CHARS_REMOVED_EXT));
    let ls = byline.createStream();
    let et = new ExtractTrialStream();
    let rm = new RemapDiseasesStream(this.thesaurusLookup, this.old_diseases);
    let ts = new DiseaseReporter();
    let tdr = new TrialDiseaseReporter();
    let rt = new TrialIDReporter();
    let dmr = new DiseaseMenuReporter(this.thesaurusLookup);
    //let gs = new GeoCodingStream();
    let jw = JSONStream.stringify();
    let ws = fs.createWriteStream(path.join(os.homedir(), TRIALS_FILEPATH + SUPPLEMENTED_EXT));
//TODO: add extract disease, and then add map diseases.
    rs.on("error", (err) => { logger.error(err); })
      .pipe(ls)
      .on("error", (err) => { logger.error(err); })
      .pipe(et)
      .on("error", (err) => { logger.error(err); })
      //Skipping Remapping Trials      
      //.pipe(rm)
      //.on("error", (err) => { logger.error(err); })      
      .pipe(dmr)
      .on("error", (err) => { logger.error(err); })
      //.pipe(gs)
      //.on("error", (err) => { logger.error(err); })
      .pipe(jw)
      .on("error", (err) => { logger.error(err); })
      .pipe(ws)
      .on("error", (err) => { logger.error(err); })
      .on("finish", (err, res) => { 

        async.waterfall([
          (next) => {dmr.},
          (next) => {this._outputDiseaseMenuReports(dmr, next);},
          (next) => {this._outputDiseaseMenus(dmr, next);}
        ],(err) => {
          let termCacheCount = this.thesaurusLookup.getNumCachedTerms();
          logger.info(`Terms Queried: ${termCacheCount}`);

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

  /**
   * This outputs the Primary Cancer, Sub-types, stages and findings/abnormalities
   * @param {*} dmr 
   * @param {*} done 
   */
  _outputDiseaseMenus(dmr, done) {
    logger.info("Outputting disease menu json...");

    let trialdiseases = dmr.getReportedDiseases();

    //Makes multi dim array
    let grouped = _.groupBy(trialdiseases, disease => disease[5] != '' ? (disease[5] + '/' + disease[2]) : disease[2]);
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

    let timestamp = moment().format('YYYYMMDD_hhmmss');
    let menu_dir = "menu_" + timestamp;
    let menu_path = path.join(os.homedir(), TRIALS_FILEPATH.replace("trials.out", menu_dir));    

    async.waterfall([
      //Make the menu folder.
      (next) => { fs.mkdir(menu_path, next); },
      //Build the root menu and spitout the JSON.
      (next) => {
        this._saveCancerRoot(uniqDiseases, menu_path, next);
      },
      //Build all sub menus
      (next) => {
        this._saveCancerSubTypes(uniqDiseases, menu_path, next);
      },
      (next) => {
        this._saveCancerStages(uniqDiseases, menu_path, next);
      }
    ],
    done
    )
  }

  /**
   * Build and Save Cancer Root Menu
   * @param {*} uniqDiseases 
   * @param {*} menu_path 
   * @param {*} done 
   */
  _saveCancerRoot(uniqDiseases, menu_path, done) {
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

      //Unique the list and convert into what we want.
      let rootMenu = _.unionBy(parents, 'termID')
        .map(mi => {
          return {
            "key": mi.displayName,
            "codes": [ mi.termID ]
          }
        });

      let root_menu = JSON.stringify(rootMenu);
      
      fs.writeFile(path.join(menu_path, "cancer_root.json"), root_menu, (err) => {
        if (err) {
          return done(err);
        } else {
          return done();
        }
      });
  }

  /**
   * Build and save Cancer Sub-types menu
   * @param {*} uniqDiseases 
   * @param {*} menu_path 
   * @param {*} done 
   */
  _saveCancerSubTypes(uniqDiseases, menu_path, done) {
      let groupedMenus = _(uniqDiseases)
        .filter(mi => { return (mi.menu == "Neoplasm" && mi.parentID != '')} )
        .groupBy('parentID')
        .value();

      async.each(
        _.keys(groupedMenus),
        (parentID, cb) => {
          this._saveCancerSubTypeMenu(parentID, groupedMenus[parentID], menu_path, cb);
        },
        (err) => {
          if (err) {
            return done(err);
          } else {
            return done();
          }
        }
      );
  }

  /**
   * Outputs a single Sub Type Menu
   * @param {*} parentID 
   * @param {*} menuItems 
   * @param {*} menu_path 
   * @param {*} done 
   */
  _saveCancerSubTypeMenu(parentID, menuItems, menu_path, done) {
    let menu = JSON.stringify(_.sortBy(menuItems, 'displayName').map(mi => {
      return {
        "key": mi.displayName,
        "codes": [ mi.termID ]
      }
    }));
    
    fs.writeFile(path.join(menu_path, `cancer_${parentID}.json`), menu, (err) => {
      if (err) {
        return done(err);
      } else {
        return done();
      }
    });
  }

  _saveCancerStages(uniqDiseases, menu_path, done) {

    

    done();
  }


  _outputDiseaseMenuReports(dmr, callback) {
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

      //let grouped = _.groupBy(trialdiseases, disease => disease[4] != '' ? (disease[4] + '/' + disease[1]) : disease[1]);
      let grouped = _.groupBy(trialdiseases, disease => disease[5] != '' ? (disease[5] + '/' + disease[2]) : disease[2]);

      _.each(grouped, (diseaseGroup, termID) => { //Note, diseaseGroup,termID is value,key
          //Assume disease Group always has at least one element

          let diseaseInfo = [
            diseaseGroup[0][1],
            diseaseGroup[0][2],
            diseaseGroup[0][3],
            diseaseGroup[0][4],
            diseaseGroup[0][5],
            diseaseGroup[0][6],
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
      (next) => { trialsReporter._loadOldDiseaseMap(next); },
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