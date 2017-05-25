const _                   = require("lodash");
const moment              = require("moment");
const Transform           = require("stream").Transform;
const Logger              = require("../../common/logger");
const async               = require("async");

let logger = new Logger({ name: "add-intervention-parents-stream" });

/**
 * When transforming trials, the supplement transforms should
 * only take in trial and not have to deal with the buffer.
 * This class converts the buffer to a trial.
 *
 * @class ExtractTrialStream
 * @extends {Transform}
 */
class ExtractTrialStream extends Transform {

  constructor() {
    super({ objectMode: true });
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



      logger.info(`Extracting trial with nci_id (${trial.nci_id})...`);

      this.push(trial);

      return next();

    } else {
      return next(); // Skip this record.
    }
  }

}

module.exports = ExtractTrialStream;