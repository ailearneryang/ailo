import type {ComponentProps} from 'react';
import {Icon} from './icon';

type IconName=ComponentProps<typeof Icon>['name'];
const toolIcons:Record<string,IconName>={
 run_command:'terminal',build_android:'terminal',command_interrupted:'terminal',
 web_search:'search',search_materials:'search',browser:'globe',amap:'pin',
 read_file:'file',write_file:'edit',edit_file:'edit',edit_spreadsheet:'grid',artifact:'file',
 read_material:'book',read_source:'book',inspect_source:'search',batch_read:'book',list_files:'folder-open',
 view_image:'image',android_device:'device',mcp:'plug',feishu:'chat',knowledge:'book',
 read_history:'clock',read_execution:'clock',memory:'memory',assistant:'chat',subagent:'user',
 request_directory:'lock',request_network:'globe',permission_requested:'lock',permission_required:'lock',
 verify:'check',acceptance_check:'check',tool_error:'info',load_skill:'sparkles',request_tools:'tool',
};

// Decorative identity; adjacent text remains the source of operation/status meaning.
export function ExecutionIcon({kind='tool',action,state}:{kind?:'skill'|'expert'|'tool';action?:string;state?:string}) {
 const name=kind==='skill'?'sparkles':kind==='expert'?'user':toolIcons[action||'']||'tool';
 return <span className={`execution-icon execution-icon-${kind}${state?' execution-icon-'+state:''}`} aria-hidden="true"><Icon name={name}/></span>;
}
