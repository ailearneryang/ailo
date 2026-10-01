import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));
export default defineConfig({base:'./',define:{__AILO_VERSION__:JSON.stringify(version)}});
