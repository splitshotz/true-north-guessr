// name, province, lat, lon, population (2021 census, rounded)
export const CITIES = [
  // British Columbia
  ['Vancouver','BC',49.2827,-123.1207,662000],['Surrey','BC',49.1913,-122.8490,568000],
  ['Burnaby','BC',49.2488,-122.9805,249000],['Richmond','BC',49.1666,-123.1336,210000],
  ['Abbotsford','BC',49.0504,-122.3045,154000],['Coquitlam','BC',49.2838,-122.7932,149000],
  ['Kelowna','BC',49.8880,-119.4960,145000],['Victoria','BC',48.4284,-123.3656,92000],
  ['Nanaimo','BC',49.1659,-123.9401,100000],['Kamloops','BC',50.6745,-120.3273,98000],
  ['Prince George','BC',53.9171,-122.7497,77000],['Chilliwack','BC',49.1579,-121.9515,93000],
  ['Vernon','BC',50.2671,-119.2720,45000],['Penticton','BC',49.4991,-119.5937,37000],
  ['Whistler','BC',50.1163,-122.9574,14000],['Tofino','BC',49.1530,-125.9066,2500],
  ['Prince Rupert','BC',54.3150,-130.3208,12300],['Nelson','BC',49.4928,-117.2948,11000],
  ['Squamish','BC',49.7016,-123.1558,24000],['Fort St. John','BC',56.2465,-120.8476,21000],
  // Alberta
  ['Calgary','AB',51.0447,-114.0719,1307000],['Edmonton','AB',53.5461,-113.4938,1011000],
  ['Red Deer','AB',52.2690,-113.8116,101000],['Lethbridge','AB',49.6956,-112.8451,98000],
  ['St. Albert','AB',53.6305,-113.6256,68000],['Medicine Hat','AB',50.0405,-110.6764,63000],
  ['Grande Prairie','AB',55.1707,-118.7947,64000],['Airdrie','AB',51.2927,-114.0134,74000],
  ['Fort McMurray','AB',56.7268,-111.3790,68000],['Banff','AB',51.1784,-115.5708,8300],
  ['Jasper','AB',52.8737,-118.0814,4700],['Canmore','AB',51.0884,-115.3479,16000],
  ['Drumheller','AB',51.4639,-112.7102,7900],
  // Saskatchewan
  ['Saskatoon','SK',52.1579,-106.6702,266000],['Regina','SK',50.4452,-104.6189,226000],
  ['Prince Albert','SK',53.2033,-105.7531,38000],['Moose Jaw','SK',50.3934,-105.5519,34000],
  ['Swift Current','SK',50.2851,-107.7972,17000],['Yorkton','SK',51.2139,-102.4628,16000],
  ['North Battleford','SK',52.7575,-108.2861,14000],
  // Manitoba
  ['Winnipeg','MB',49.8951,-97.1384,750000],['Brandon','MB',49.8485,-99.9501,51000],
  ['Steinbach','MB',49.5258,-96.6845,18000],['Thompson','MB',55.7435,-97.8558,13000],
  ['Churchill','MB',58.7684,-94.1650,900],['Portage la Prairie','MB',49.9728,-98.2919,13000],
  // Ontario
  ['Toronto','ON',43.6532,-79.3832,2794000],['Ottawa','ON',45.4215,-75.6972,1017000],
  ['Mississauga','ON',43.5890,-79.6441,718000],['Brampton','ON',43.7315,-79.7624,656000],
  ['Hamilton','ON',43.2557,-79.8711,569000],['London','ON',42.9849,-81.2453,422000],
  ['Markham','ON',43.8561,-79.3370,339000],['Vaughan','ON',43.8361,-79.4983,323000],
  ['Kitchener','ON',43.4516,-80.4925,257000],['Windsor','ON',42.3149,-83.0364,230000],
  ['Oakville','ON',43.4675,-79.6877,214000],['Burlington','ON',43.3255,-79.7990,187000],
  ['Richmond Hill','ON',43.8828,-79.4403,202000],['Oshawa','ON',43.8971,-78.8658,175000],
  ['Barrie','ON',44.3894,-79.6903,148000],['St. Catharines','ON',43.1594,-79.2469,137000],
  ['Guelph','ON',43.5448,-80.2482,144000],['Waterloo','ON',43.4643,-80.5204,121000],
  ['Cambridge','ON',43.3616,-80.3144,138000],['Kingston','ON',44.2312,-76.4860,132000],
  ['Sudbury','ON',46.4917,-80.9930,166000],['Thunder Bay','ON',48.3809,-89.2477,109000],
  ['Niagara Falls','ON',43.0896,-79.0849,94000],['Peterborough','ON',44.3091,-78.3197,84000],
  ['Sault Ste. Marie','ON',46.5219,-84.3461,72000],['North Bay','ON',46.3091,-79.4608,53000],
  ['Timmins','ON',48.4758,-81.3305,41000],['Belleville','ON',44.1628,-77.3832,55000],
  ['Sarnia','ON',42.9745,-82.4066,72000],['Kenora','ON',49.7670,-94.4894,15000],
  ['Collingwood','ON',44.5008,-80.2169,25000],['Huntsville','ON',45.3268,-79.2185,21000],
  // Quebec
  ['Montreal','QC',45.5019,-73.5674,1763000],['Quebec City','QC',46.8139,-71.2080,549000],
  ['Laval','QC',45.6066,-73.7124,438000],['Gatineau','QC',45.4765,-75.7013,291000],
  ['Longueuil','QC',45.5312,-73.5181,254000],['Sherbrooke','QC',45.4042,-71.8929,173000],
  ['Saguenay','QC',48.4280,-71.0680,145000],['Lévis','QC',46.8033,-71.1779,150000],
  ['Trois-Rivières','QC',46.3432,-72.5421,139000],['Terrebonne','QC',45.6929,-73.6331,120000],
  ['Saint-Jean-sur-Richelieu','QC',45.3071,-73.2625,98000],['Drummondville','QC',45.8838,-72.4843,79000],
  ['Rimouski','QC',48.4489,-68.5236,49000],['Rouyn-Noranda','QC',48.2366,-79.0230,42000],
  ['Sept-Îles','QC',50.2001,-66.3821,25000],['Gaspé','QC',48.8316,-64.4869,15000],
  ['Tadoussac','QC',48.1450,-69.7168,800],['Mont-Tremblant','QC',46.1185,-74.5962,11000],
  ['Baie-Saint-Paul','QC',47.4400,-70.4980,7400],["Val-d'Or",'QC',48.0975,-77.7828,33000],
  // New Brunswick
  ['Moncton','NB',46.0878,-64.7782,79000],['Saint John','NB',45.2733,-66.0633,70000],
  ['Fredericton','NB',45.9636,-66.6431,63000],['Dieppe','NB',46.0984,-64.7242,28000],
  ['Miramichi','NB',47.0293,-65.5019,18000],['Bathurst','NB',47.6187,-65.6511,12000],
  ['Edmundston','NB',47.3737,-68.3251,16000],['St. Andrews','NB',45.0734,-67.0532,2000],
  // Nova Scotia
  ['Halifax','NS',44.6488,-63.5752,440000],['Sydney','NS',46.1368,-60.1942,30000],
  ['Truro','NS',45.3647,-63.2869,13000],['Lunenburg','NS',44.3770,-64.3093,2300],
  ['Wolfville','NS',45.0915,-64.3628,5100],['Yarmouth','NS',43.8374,-66.1174,6500],
  ['Antigonish','NS',45.6214,-61.9978,4700],
  // Prince Edward Island
  ['Charlottetown','PE',46.2382,-63.1311,39000],['Summerside','PE',46.3934,-63.7902,16000],
  // Newfoundland and Labrador
  ["St. John's",'NL',47.5615,-52.7126,111000],['Corner Brook','NL',48.9500,-57.9522,19000],
  ['Mount Pearl','NL',47.5189,-52.8058,22000],['Gander','NL',48.9566,-54.6087,12000],
  ['Happy Valley-Goose Bay','NL',53.3017,-60.3261,8000],['Grand Falls-Windsor','NL',48.9363,-55.6623,14000],
  ['Twillingate','NL',49.6474,-54.7605,2100],['Labrador City','NL',52.9463,-66.9114,7400],
  // Territories
  ['Whitehorse','YT',60.7212,-135.0568,28000],['Dawson City','YT',64.0601,-139.4320,1600],
  ['Yellowknife','NT',62.4540,-114.3718,20000],['Inuvik','NT',68.3607,-133.7230,3100],
  ['Hay River','NT',60.8156,-115.7999,3200],
  ['Iqaluit','NU',63.7467,-68.5170,7400],['Rankin Inlet','NU',62.8090,-92.0853,3000],
  ['Cambridge Bay','NU',69.1169,-105.0597,1800],
].map(([name, prov, lat, lon, pop]) => ({ name, prov, lat, lon, pop }));

export const PROVINCES = {
  BC: 'British Columbia', AB: 'Alberta', SK: 'Saskatchewan', MB: 'Manitoba', ON: 'Ontario',
  QC: 'Quebec', NB: 'New Brunswick', NS: 'Nova Scotia', PE: 'Prince Edward Island',
  NL: 'Newfoundland and Labrador', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
};

export const REGIONS = {
  all: { label: 'All of Canada', provs: Object.keys(PROVINCES) },
  west: { label: 'West Coast (BC)', provs: ['BC'] },
  prairies: { label: 'Prairies (AB, SK, MB)', provs: ['AB', 'SK', 'MB'] },
  ontario: { label: 'Ontario', provs: ['ON'] },
  quebec: { label: 'Quebec', provs: ['QC'] },
  atlantic: { label: 'Atlantic (NB, NS, PE, NL)', provs: ['NB', 'NS', 'PE', 'NL'] },
  north: { label: 'The North (YT, NT, NU)', provs: ['YT', 'NT', 'NU'] },
};

// cities for the "City Streets" mode: guess the exact spot inside one city
export const LOCAL_CITIES = ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa',
  'Winnipeg', 'Quebec City', 'Halifax', 'Hamilton', 'Victoria', 'Saskatoon', 'Regina', "St. John's", 'Kitchener'];
