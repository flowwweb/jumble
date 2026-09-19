// Host-only operations reuse Firebase CLI authentication without exposing credentials.
// Usage: node scripts/provider-admin.cjs <firebase-tools/lib absolute path> inspect|billing <project> [account]
const path = require('node:path');
const [lib,action,project,account] = process.argv.slice(2);
if(!lib||!project||!['inspect','billing','database'].includes(action))throw new Error('Invalid arguments');
(async()=>{
  const auth=require(path.join(lib,'auth.js'));
  const {requireAuth}=require(path.join(lib,'requireAuth.js'));
  await requireAuth({...auth.getGlobalDefaultAccount(),project,nonInteractive:true});
  const billing=require(path.join(lib,'gcp/cloudbilling.js'));
  if(action==='inspect'){
    const {Client}=require(path.join(lib,'apiv2.js'));
    const client=new Client({urlPrefix:'https://cloudbilling.googleapis.com',apiVersion:'v1'});
    const info=await client.get(`/projects/${project}/billingInfo`);
    console.log(JSON.stringify({billing:info.body,accounts:(await billing.listBillingAccounts()).map(({name,displayName,open})=>({name,displayName,open}))}));
  }
  if(action==='billing'){
    if(!account||!/^billingAccounts\/[A-Z0-9-]+$/.test(account))throw new Error('Exact billing account required');
    console.log(JSON.stringify({project,billingEnabled:await billing.setBillingAccount(project,account)}));
  }
  if(action==='database'){
    const {Client}=require(path.join(lib,'apiv2.js'));
    const client=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
    const result=await client.post(`/projects/${project}/databases`,{name:`projects/${project}/databases/(default)`,locationId:'nam5',type:'FIRESTORE_NATIVE'},{queryParams:{databaseId:'(default)'}});
    console.log(JSON.stringify({operation:result.body.name}));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
