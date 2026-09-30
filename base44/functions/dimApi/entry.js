import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { handle } from './handler.js';

export default async function(req){
 const base44=createClientFromRequest(req);
 return handle(req,{
  authenticate:()=>base44.auth.me(),
  repoFactory:()=>base44.asServiceRole.entities.DimSession,
  getSecret:name=>secrets.get(name),
 });
}
