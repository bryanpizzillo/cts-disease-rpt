const _                     = require("lodash");
const Logger                = require("../logger");
const NCIThesaurusTerm      = require("./nci_thesaurus_term");
const https                 = require("https");
const AbstractLexEVSClient  = require("./base_lexevs_client");

let logger = new Logger({name: "lex-evs-client"});

/**
 * A class for accessing the LexEVS CTS2 servers
 * 
 * @class LexEVSClient
 */
class LexEVSClient extends AbstractLexEVSClient {

  constructor(host = "lexevscts2.nci.nih.gov") {
    super(host);
  }

  _buildUrl(codeSystem, codeSystemVersion, method) {
    let url = `https://${this.host}/lexevscts2/codesystem/${codeSystem}`
    if (codeSystemVersion) {
      url += `/version/${codeSystemVersion}`;
    }
    url += `${method}?format=json`;

    return url;
  }

  /**
   * Calls the LexEVS Read Entity endpoint
   * 
   * @param {any} codeSystem
   * @param {any} codeSystemVersion
   * @param {any} entityID
   * @param {any} done
   * 
   * @memberOf LexEVSClient
   */
  readEntity(codeSystem, codeSystemVersion, entityID, done) {
    //EX URL: https://lexevscts2.nci.nih.gov/lexevscts2/codesystem/NCI_Thesaurus/version/17.01e/entity/C16357?format=json
    let url = this._buildUrl(codeSystem, codeSystemVersion, `/entity/${entityID}`);

      https.get(url, (res) => {

        if (res.statusCode == 404) {
          return done(null,null);
        } else if (res.statusCode != 200) {                    
          return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
        }

        let content = '';

        //Read from stream
        res.on('data', (chunk) => content += chunk);
        //... until done, then process the content.
        res.on('end', () => {
            
            let rawObj = null;
            
            //Parse can throw, so we handle the exception and bail if 
            //it did not work.
            try {
              rawObj = JSON.parse(content);
            } catch (err) {
              //TODO: add additional info to the error.
              return done(err);
            }
            done(null, rawObj);
        });
        //TODO: add additional info to the error.
      }).on('error', done);    
  }

  /**
   * Calls the SubjectOf endpoint
   * 
   * @param {any} codeSystem
   * @param {any} codeSystemVersion
   * @param {any} entityID
   * @param {any} done
   * 
   * @memberOf LexEVSClient
   */
  getSubjectOf(codeSystem, codeSystemVersion, entityID, done) {
    let url = this._buildUrl(codeSystem, codeSystemVersion, `/entity/${entityID}/subjectof`);

    https.get(url, (res) => {

      if (res.statusCode != 200) {          
        return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
      }

      let content = '';

      //Read from stream
      res.on('data', (chunk) => content += chunk);
      //... until done, then process the content.
      res.on('end', () => {
          
          let rawObj = null;
          
          //Parse can throw, so we handle the exception and bail if 
          //it did not work.
          try {
            rawObj = JSON.parse(content);
          } catch (err) {
            //TODO: add additional info to the error.
            return done(err);
          }
          done(null, rawObj);
      });
      //TODO: add additional info to the error.
    }).on('error', done);    

  }

}

module.exports = LexEVSClient;
