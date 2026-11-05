import type {ExecutionActivity} from './types';
export function ExecutionStatuses({statuses}:{statuses?:ExecutionActivity['statuses']}){
 if(!statuses?.length)return null;
 return <ol className="execution-statuses" aria-label="实时处理进展">{statuses.map(item=><li key={item.id}><time dateTime={item.at}>{new Date(item.at).toLocaleTimeString('zh-CN',{hour12:false})}</time><span>{item.message}</span></li>)}</ol>;
}
