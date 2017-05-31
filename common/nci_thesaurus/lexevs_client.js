const _                     = require("lodash");
const Logger                = require("../logger");
const NCIThesaurusTerm      = require("./nci_thesaurus_term");
const request               = require('request');
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
    this.baseRequest = request.defaults({
      forever: true,
      json:true,
      pool: {maxSockets: 3}
    });
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

    this.baseRequest.get(
      {
        url: url
      }, (err, res, lexObj) => {

        if (err) {
          return done(err);
        } else if (res.statusCode == 404) {
          return done (null, null);
        } else if (res.statusCode != 200) {          
          return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
        } else {
          return done(null, lexObj);
        }      
    })    
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
    //maxtoreturn hack to make sure we get all associations in one call.
    let url = this._buildUrl(codeSystem, codeSystemVersion, `/entity/${entityID}/subjectof`) + "&maxtoreturn=1000";

    this.baseRequest.get(
      {
        url: url,
        forever: true,
        json:true
      }, (err, res, lexObj) => {

        if (err) {
          return done(err);
        } else if (res.statusCode != 200) {          
          return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
        } else {
          return done(null, lexObj);
        }      
    })    

  }

  /**
   * Calls the children endpoint
   * 
   * @param {any} codeSystem
   * @param {any} codeSystemVersion
   * @param {any} entityID
   * @param {any} done
   * 
   * @memberOf LexEVSClient
   */
  getChildren(codeSystem, codeSystemVersion, entityID, done) {
    //maxtoreturn hack to make sure we get all associations in one call.
    let url = this._buildUrl(codeSystem, codeSystemVersion, `/entity/${entityID}/children`) + "&maxtoreturn=1000";

    this.baseRequest.get(
      {
        url: url,
        forever: true,
        json:true
      }, (err, res, lexObj) => {

        if (err) {
          return done(err);
        } else if (res.statusCode != 200) {          
          return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
        } else {
          return done(null, lexObj);
        }      
    })    

  }

}

module.exports = LexEVSClient;
