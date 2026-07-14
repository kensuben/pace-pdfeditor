import http from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const port=Number(process.env.PORT||3001),file=process.env.DATA_FILE||'/data/store.json'
const clientId=process.env.MICROSOFT_CLIENT_ID||'',tenant=process.env.MICROSOFT_TENANT_ID||'common'
const bootstrapAdmins=(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)
const issuerTenant=tenant==='common'?'organizations':tenant
const jwks=createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${issuerTenant}/discovery/v2.0/keys`))
let store={users:[],groups:[],logs:[],sessions:{}}
try{store=JSON.parse(await readFile(file,'utf8'))}catch{await mkdir(dirname(file),{recursive:true})}
let saveQueue=Promise.resolve()
const save=()=>saveQueue=saveQueue.then(async()=>{const temp=`${file}.tmp`;await writeFile(temp,JSON.stringify(store));await rename(temp,file)})
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))}
const body=async(req)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
const tokenOf=req=>(req.headers.authorization||'').replace(/^Bearer\s+/i,'')
async function identity(req){
  const token=tokenOf(req);if(!token)throw Object.assign(new Error('Missing token'),{status:401})
  const {payload}=await jwtVerify(token,jwks,{audience:clientId})
  const email=String(payload.preferred_username||payload.email||'').toLowerCase();if(!email)throw Object.assign(new Error('Email claim missing'),{status:403})
  let user=store.users.find(x=>x.email===email)
  if(!user&&bootstrapAdmins.includes(email)){user={id:crypto.randomUUID(),email,name:String(payload.name||email),role:'admin',active:true,groupIds:[],createdAt:new Date().toISOString()};store.users.push(user);await save()}
  if(!user||!user.active)throw Object.assign(new Error('Account is not authorized'),{status:403})
  return {...user,oid:String(payload.oid||payload.sub||'')}
}
const admin=user=>{if(user.role!=='admin')throw Object.assign(new Error('Admin required'),{status:403})}
const route=(req,path)=>new URL(req.url,`http://${req.headers.host}`).pathname===path

const server=http.createServer(async(req,res)=>{
  try{
    if(route(req,'/healthz'))return json(res,200,{ok:true})
    const user=await identity(req),url=new URL(req.url,`http://${req.headers.host}`)
    if(req.method==='POST'&&route(req,'/api/auth/session')){store.sessions[user.id]={email:user.email,name:user.name,lastSeen:new Date().toISOString()};await save();return json(res,200,{user})}
    if(req.method==='POST'&&route(req,'/api/heartbeat')){store.sessions[user.id]={email:user.email,name:user.name,lastSeen:new Date().toISOString()};await save();return json(res,200,{ok:true})}
    if(req.method==='POST'&&route(req,'/api/activities')){const input=await body(req);store.logs.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),userId:user.id,userEmail:user.email,userName:user.name,sessionId:String(input.sessionId||''),action:String(input.action||''),level:String(input.level||'info'),description:String(input.description||''),metadata:input.metadata||{}});await save();return json(res,201,{ok:true})}
    if(req.method==='GET'&&route(req,'/api/me/activities'))return json(res,200,store.logs.filter(x=>x.userId===user.id).slice(-1000).reverse())
    if(url.pathname.startsWith('/api/admin/'))admin(user)
    if(req.method==='GET'&&route(req,'/api/admin/overview')){const cutoff=Date.now()-90000,online=Object.values(store.sessions).filter(x=>Date.parse(x.lastSeen)>=cutoff);return json(res,200,{online,totalUsers:store.users.length,totalGroups:store.groups.length,totalLogs:store.logs.length})}
    if(req.method==='GET'&&route(req,'/api/admin/users'))return json(res,200,store.users)
    if(req.method==='POST'&&route(req,'/api/admin/users')){const input=await body(req),email=String(input.email||'').trim().toLowerCase();if(!email)return json(res,400,{error:'Email required'});let item=store.users.find(x=>x.email===email);if(item)Object.assign(item,input,{email});else{item={id:crypto.randomUUID(),email,name:input.name||email,role:input.role==='admin'?'admin':'user',active:input.active!==false,groupIds:input.groupIds||[],createdAt:new Date().toISOString()};store.users.push(item)}await save();return json(res,200,item)}
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/users/')){const item=store.users.find(x=>x.id===url.pathname.split('/').pop());if(!item)return json(res,404,{error:'Not found'});Object.assign(item,await body(req),{id:item.id,email:item.email});await save();return json(res,200,item)}
    if(req.method==='GET'&&route(req,'/api/admin/groups'))return json(res,200,store.groups)
    if(req.method==='POST'&&route(req,'/api/admin/groups')){const input=await body(req),item={id:crypto.randomUUID(),name:String(input.name||'').trim(),description:String(input.description||''),createdAt:new Date().toISOString()};if(!item.name)return json(res,400,{error:'Name required'});store.groups.push(item);await save();return json(res,201,item)}
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/admin/groups/')){const id=url.pathname.split('/').pop();store.groups=store.groups.filter(x=>x.id!==id);store.users.forEach(x=>x.groupIds=x.groupIds.filter(g=>g!==id));await save();return json(res,200,{ok:true})}
    if(req.method==='GET'&&route(req,'/api/admin/logs')){const q=(url.searchParams.get('q')||'').toLowerCase(),level=url.searchParams.get('level')||'',email=(url.searchParams.get('email')||'').toLowerCase(),from=url.searchParams.get('from'),to=url.searchParams.get('to');const logs=store.logs.filter(x=>(!q||JSON.stringify(x).toLowerCase().includes(q))&&(!level||x.level===level)&&(!email||x.userEmail.includes(email))&&(!from||x.timestamp>=from)&&(!to||x.timestamp<=to));return json(res,200,logs.slice(-5000).reverse())}
    if(req.method==='DELETE'&&route(req,'/api/admin/logs')){const input=await body(req),from=String(input.from||''),to=String(input.to||'');if(!from||!to)return json(res,400,{error:'from and to are required'});const before=store.logs.length;store.logs=store.logs.filter(x=>x.timestamp<from||x.timestamp>to);await save();return json(res,200,{deleted:before-store.logs.length})}
    return json(res,404,{error:'Not found'})
  }catch(error){console.error(error);return json(res,error.status||500,{error:error.message||'Server error'})}
})
server.listen(port,'0.0.0.0',()=>console.log(`API listening on ${port}`))
