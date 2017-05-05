const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "trialid-reporter" });

/**
 * Supplements trials by adding appropriate NCIt values and other terms
 *
 * @class TransformStream
 * @extends {Transform}
 */
class TrialIDReporter extends Transform {

  constructor() {
    super({ objectMode: true });

    //Create hashes
    this.trialIDs = [];
  }

  getReportedTrialIDs() {
      return this.trialIDs;
  }

  /**
   * Group up all diseases from the supplied trial
   * @param {*} trial 
   */
  _inventoryViewAbleTrials(trial) {
    switch(trial.current_trial_status) {
      case 'Active':
      case 'Approved':
      case 'Enrolling by Invitation':
      case 'In Review':
      case 'Temporarily Closed to Accrual': 
      case 'Temporarily Closed to Accrual and Intervention':
        this.trialIDs.push(trial.nct_id);
        break;        
    }
    
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

      logger.info(`TrialID reporting for trial with nci_id (${trial.nci_id})...`);

      this._inventoryViewAbleTrials(trial);

      this.push(trial);
      next();

    } else {
      next(); // Skip this record.
    }
  }

}

module.exports = TrialIDReporter;
