const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "supplement-stream" });

/**
 * Supplements trials by adding appropriate NCIt values and other terms
 *
 * @class TransformStream
 * @extends {Transform}
 */
class TrialDiseaseReporter extends Transform {

  constructor() {
    super({ objectMode: true });

    //Create hashes
    this.diseases = []
  }

  getReportedDiseases() {
      return this.diseases;
  }

  /**
   * Group up all diseases from the supplied trial
   * @param {*} trial 
   */
  _inventoryDiseases(trial) {
    let trial_diseases = [];

    _.filter(trial.diseases, ["inclusion_indicator", "TRIAL"]).forEach((disease) => {      
        let ncitCode = disease.nci_thesaurus_concept_id;
        if (!_.includes(trial_diseases, ncitCode)) { 
          trial_diseases.splice(_.sortedIndex(trial_diseases, ncitCode), 0, ncitCode);
        }
    });  

    let diseaseList = trial_diseases.join(',');
    
    this.diseases.push([trial.nci_id, diseaseList]);

    //TODO: Maybe generate permutations to see where combinations clump
  }

  _transform(buffer, enc, next) {

    let line = buffer.toString();
    if (line.slice(0, 2) === " {") {
      var trial;
      try {
        trial = JSON.parse(line);
      } catch (err) {
        // TODO: send this as an alert email/sms
        // logger.error("Could not parse trial: " + line);
        logger.error(err);
        return next();
      }

      logger.info(`Disease reporting for trial with nci_id (${trial.nci_id})...`);

      this._inventoryDiseases(trial);

      this.push(trial);
      next();

    } else {
      next(); // Skip this record.
    }
  }

}

module.exports = TrialDiseaseReporter;
