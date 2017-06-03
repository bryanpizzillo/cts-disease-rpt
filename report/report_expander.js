const _                   = require("lodash");
const babyparse           = require("babyparse");


csv = babyparse.parseFiles(
  './DiseaseRemapSheet.txt', {
    header: false,
    delimiter: "|"
  }
);

csv.data.forEach((row) => {
  let oldcode = row[0];
  let status = row[1];
  let oldname = row[2];
  let newid = row[3];
  let newname = row[4];
  let trials = row[5];
  if (trials) {
    trials.split(",").forEach((trialid) => {
      console.log([
        trialid, oldcode, status, oldname, newid, newname
      ].join('|'));
    })
  } else {
    console.log(row);
  }
});
