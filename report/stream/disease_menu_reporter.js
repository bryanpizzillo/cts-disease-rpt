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
class DiseaseReporter extends Transform {

  constructor(thesaurusLookup) {
    super({ objectMode: true });

    this.thesaurusLookup = thesaurusLookup;

    //Create hashes
    this.diseases = [];
  }

  getReportedDiseases() {
      return this.diseases;
  }

  _getDiseaseInfo(disease, done) {
    this.thesaurusLookup.getTerm(disease.nci_thesaurus_concept_id, (err, term) => {
      if (err) {
        return done(err);
      }

      let rtnTermInfo = {
        termID: disease.nci_thesaurus_concept_id,
        termType: '',
        primary: '',
        secondary: '',
        stage_or_grade: '',
        finding_or_abnormality: '',
        side_effect: '',
        unknown: ''
      };
      
      if (!term) {
        rtnTermInfo.termType = "!!MISSING!!";
        return done(null, rtnTermInfo);
      }

      if (term.isA("Neoplastic Process")) {

        //Identify Parent/Sub-parent

        if (term.hasSubjectOfAssociation("Disease_Is_Stage") || term.hasSubjectOfAssociation("Disease_Is_Grade")) {
          rtnTermInfo.termType = 'Stage or Grade';
          rtnTermInfo.stage_or_grade = term.preferredName;
        } else {

          rtnTermInfo.termType = 'Secondary';
          rtnTermInfo.secondary = term.preferredName;
        }
      } 
      else if (
        term.isA("Laboratory or Test Result") || 
        term.isA("Finding") ||
        term.isA("Cell or Molecular Dysfunction") ||
        term.isA("Gene or Genome") ||
        term.isA("Clinical Attribute")
      ) {
        //Finding...
        rtnTermInfo.termType = 'Finding or Abnormality';
        rtnTermInfo.finding_or_abnormality = term.preferredName;
      }
      else if (
        term.isA("Disease or Syndrome") || 
        term.isA("Sign or Symptom") || 
        term.isA("Mental or Behavioral Dysfunction")
      ) {
        //Side Effect?
        rtnTermInfo.termType = 'Side Effect';
        rtnTermInfo.side_effect = term.preferredName;
      }
      else {        
        rtnTermInfo.termType = 'UNKNOWN';
        rtnTermInfo.unknown = term.preferredName;
        console.log(`${term.preferredName} (${term.entityID}) is not a known type`);
        console.log(term.semanticTypes);
      }



      return done(null, rtnTermInfo);
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
      3,
      (disease, next) => {
        //fetch disease
        this._getDiseaseInfo(disease, (err, diseaseInfo) => {
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
          this.diseases.push([
            trial.nci_id, 
            diseaseInfo.termID,
            diseaseInfo.termType,
            diseaseInfo.primary, 
            diseaseInfo.secondary,
            diseaseInfo.stage_or_grade,
            diseaseInfo.finding_or_abnormality,
            diseaseInfo.side_effect,
            diseaseInfo.unknown
          ]);

          next();
        })
      },
      done
    );
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

      this._inventoryDiseases(trial, (err, res) => {
        this.push(trial);
        next(err);
      });

    } else {
      next(); // Skip this record.
    }
  }

}

module.exports = DiseaseReporter;
