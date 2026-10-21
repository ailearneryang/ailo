// No-action pauses and task/protocol failures remain valid failures. Only
// explicit provider availability/auth/quota responses invalidate a trial.
function serviceFailure(requests,error){
 if(!error)return false;
 const status=requests.at(-1)?.httpStatus;
 return [401,402,403,429].includes(status)||Number.isInteger(status)&&status>=500&&status<=599;
}
module.exports={serviceFailure};
