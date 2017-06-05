const _                     = require("lodash");
const async                 = require("async");
const fs                    = require("fs");
const Logger                = require("../logger");
const NCIThesaurusTerm      = require("./nci_thesaurus_term");
const request               = require('request');
const path                  = require('path');
const mkdirp                = require('mkdirp');
const AbstractLexEVSClient  = require("./base_lexevs_client");

let logger = new Logger({name: "lex-evs-client"});

/**
 * A class for accessing the LexEVS CTS2 servers
 * 
 * @class LexEVSClient
 */
class LexEVSClient extends AbstractLexEVSClient {

  constructor(cacheDir = false, host = "lexevscts2.nci.nih.gov") {
    super(host);
    this.cacheDir = cacheDir;

    this.baseRequest = request.defaults({
      forever: true,
      json:true,
      pool: {maxSockets: 3}
    });
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

    this._fetchAndCache(url, 'entity', codeSystem, codeSystemVersion, entityID, done);
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

    this._fetchAndCache(url, 'subjectof', codeSystem, codeSystemVersion, entityID, done);  
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

    this._fetchAndCache(url, 'children', codeSystem, codeSystemVersion, entityID, done);
  }

  /**
   * Internal call to build a URL for LexEVS
   * @param {*} codeSystem 
   * @param {*} codeSystemVersion 
   * @param {*} method 
   */
  _buildUrl(codeSystem, codeSystemVersion, method) {
    let url = `https://${this.host}/lexevscts2/codesystem/${codeSystem}`
    if (codeSystemVersion) {
      url += `/version/${codeSystemVersion}`;
    }
    url += `${method}?format=json`;

    return url;
  }

  /**
   * Gets a cached request
   * @param {*} endpoint 
   * @param {*} codeSystem 
   * @param {*} codeSystemVersion 
   * @param {*} entityID 
   * @param {*} done 
   */
  _fetchCachedRequest(endpoint, codeSystem, codeSystemVersion, entityID, done) {

    if (!this.cacheDir) {
      //Note: you must have the second null in order for the params to be correct in
      //the async.waterfall
      return done(null, null);
    }

    try {  
      let resp = require(path.join(this.cacheDir, codeSystem, codeSystemVersion, endpoint, entityID));
      return done(null, resp);
    } catch (err) {
      return done(null, null); //Assume all errors are not found.
    }
  }

  /**
   * Fetches and caches the requested URL
   * @param {*} url 
   * @param {*} endpoint 
   * @param {*} codeSystem 
   * @param {*} codeSystemVersion 
   * @param {*} entityID 
   * @param {*} done 
   */
  _fetchAndCache(url, endpoint, codeSystem, codeSystemVersion, entityID, done) {

    async.waterfall([
      (next) => {
        this._fetchCachedRequest(endpoint, codeSystem, codeSystemVersion, entityID, next); },
      (resp, next) => {

        if (resp) {
          return done(null, resp);
        } else {
          this._makeRequest(url, codeSystem, codeSystemVersion, entityID, next);
        }
      },
      (resp, next) => { 
        this._cacheRequest(endpoint, codeSystem, codeSystemVersion, entityID, resp, next);}
    ], done);
  }  

  /**
   * Caches a request to the file system
   * @param {*} endpoint 
   * @param {*} codeSystem 
   * @param {*} codeSystemVersion 
   * @param {*} entityID 
   * @param {*} done 
   */
  _cacheRequest(endpoint, codeSystem, codeSystemVersion, entityID, response, done) {
    if (!this.cacheDir) {
      return done(null, response);
    }

    let cachePath = path.join(this.cacheDir, codeSystem, codeSystemVersion, endpoint);
    async.waterfall([
      (next) => {
        mkdirp(cachePath, (err) => { next(err); }); 
      },
      (next) => { 
        fs.writeFile(path.join(cachePath, entityID + ".json"), JSON.stringify(response), { encoding: 'utf8' }, (err) => {
          return next(err);
        }); 
      }
    ], (err) => { 
      if (err) {
        return done(err);
      } else {
        done(null, response);
      }
    });
  }


  /**
   * Internal call to make request to lexEVS
   * @param {*} url 
   * @param {*} codeSystem 
   * @param {*} codeSystemVersion 
   * @param {*} entityID 
   * @param {*} done 
   */
  _makeRequest(url, codeSystem, codeSystemVersion, entityID, done) {
    this.baseRequest.get(
      {
        url: url,
        forever: true,
        json:true
      }, (err, res, lexObj) => {

        if (err) {
          return done(err);
        } else if (res.statusCode == 404) {
          return done(null, null);
        } else if (res.statusCode != 200) {          
          return done(new Error(`Invalid Response code (${res.statusCode}) from LexEVS for entity ${entityID}: ${url}`));
        } else {
          return done(null, lexObj);
        }      
    })
  }

}

module.exports = LexEVSClient;
