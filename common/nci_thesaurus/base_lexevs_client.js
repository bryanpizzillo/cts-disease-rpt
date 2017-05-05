/**
 * Abstract base class for LexEVS clients
 * 
 * @class AbstractLexEVSClient
 */
class AbstractLexEVSClient {

  constructor(host) {
    if (this.constructor === AbstractLexEVSClient) {
      throw new TypeError("Cannot construct AbstractLexEVSClient");
    }

    if (this.readEntity === AbstractLexEVSClient.prototype.readEntity) {
      throw new TypeError("Must implement abstract method readEntity");
    }

    this.host = host;
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
    throw new TypeError("Cannot call abstract method readEntity from derrived class");
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
    throw new TypeError("Cannot call abstract method readEntity from derrived class");    
  }

}

module.exports = AbstractLexEVSClient;
