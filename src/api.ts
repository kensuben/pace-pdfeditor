import { getMicrosoftToken } from './auth'

export type ApiUser={id:string;email:string;name:string;role:'admin'|'user';active:boolean;groupIds:string[]}
export async function apiRequest<T>(path:string,options:RequestInit={}):Promise<T>{
  const token=await getMicrosoftToken()
  const response=await fetch(path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...options.headers}})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||`API ${response.status}`)
  return data as T
}
export const authorizeSession=()=>apiRequest<{user:ApiUser}>('/api/auth/session',{method:'POST',body:'{}'})
