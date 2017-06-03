const NCIThesaurusTerm      = require("../../../nci_thesaurus/nci_thesaurus_term");

// The purpose of this file is to encapsulate this expected object for multiple tests

module.exports = new NCIThesaurusTerm(
  "C9096", "Stage IV Skin Melanoma", "Stage IV Skin Melanoma", [
          { "source": "NCI", "sourceCode": "", "text": "Malignant Melanoma (of Skin), Stage IV", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Metastatic Cutaneous Melanoma", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Cutaneous Malignant Melanoma", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Cutaneous Melanoma", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Malignant Melanoma of Skin", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Malignant Melanoma of the Skin", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Malignant Skin Melanoma", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Melanoma of Skin", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Melanoma of the Skin", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Skin Melanoma AJCC v6", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Skin Melanoma AJCC v7", "type": "SY" },
          { "source": "NCI", "sourceCode": "", "text": "Stage IV Skin Melanoma", "type": "PT" },
          { "source": "NCI-GLOSS", "sourceCode": "", "text": "stage IV melanoma", "type": "PT" }          
        ],
        ['Neoplastic Process']
);