import json

f = open('/Users/bryanp/Development/cts-data/trials.out.diseases_list')
out = open('/Users/bryanp/Development/cts-data/disease_keys.txt', 'w')
tr = json.load(f)
f.close()

for key in tr:
    out.write('|'.join([key, ','.join(tr[key])])+'\n')

out.close()