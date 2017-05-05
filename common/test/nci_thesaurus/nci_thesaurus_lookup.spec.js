import { expect } from 'chai';
const NCIThesaurusLookup        = require("../../nci_thesaurus/nci_thesaurus_lookup");
const AbstractLexEVSClient      = require("../../nci_thesaurus/base_lexevs_client");

/**
 * Mocked LexEVSClient for testing readEntity successes
 * 
 * @class JSONTestLexEVSClient
 * @extends {AbstractLexEVSClient}
 */
class JSONTestLexEVSClient extends AbstractLexEVSClient {
  constructor(jsonFile) {
    super("EMPTY_HOST");
    this.jsonFile = jsonFile;
    this.fetchCount = 0;
    this.fetchedSystem = "";
    this.fetchedVersion = "";
    this.fetchedEntity = "";    
  }

  readEntity(codeSystem, codeSystemVersion, entityID, done) {
    this.fetchedSystem = codeSystem;
    this.fetchedVersion = codeSystemVersion;
    this.fetchedEntity = entityID;
    this.fetchCount++;

    let objData = require(this.jsonFile);
    done(null,objData);
  }

  getSubjectOf(codeSystem, codeSystemVersion, entityID, done) {
    this.fetchedSystem = codeSystem;
    this.fetchedVersion = codeSystemVersion;
    this.fetchedEntity = entityID;
    this.fetchCount++;

    //TODO: JSON file for subjectOf requests 
    let objData = require(this.jsonFile);
    done(null,objData);

  }
}

describe('nci thesaurus lookup', _ => {

    it('Should lookup a drug', () => {
        let client = new JSONTestLexEVSClient("./data/C1647_drug.json");        
        let expectedTerm = require("./data/C1647_drug_expected");

        let lookup = new NCIThesaurusLookup(client);

        lookup.getTerm("C1647", (err, actualTerm) => {
          expect(actualTerm.entityID).to.eql(expectedTerm.entityID);
          expect(actualTerm.preferredName).to.eql(expectedTerm.preferredName);
          expect(actualTerm.displayName).to.eql(expectedTerm.displayName);
          //Deep because you need to test each synonyms members too
          expect(actualTerm.synonyms).to.deep.have.members(expectedTerm.synonyms);
        });        
    });

    it('Should lookup a drug.  Only Once.', () => {
        let client = new JSONTestLexEVSClient("./data/C1647_drug.json");        
        let expectedTerm = require("./data/C1647_drug_expected");

        let lookup = new NCIThesaurusLookup(client);

        lookup.getTerm("C1647", (err1, actualTerm1) => {
          lookup.getTerm("C1647", (err2, actualTerm2) => {
            expect(client.fetchCount).to.eql(1);
            expect(actualTerm2.entityID).to.eql(expectedTerm.entityID);
          })
        });        
    });
    
});