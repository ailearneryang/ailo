const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
async function exists(p){try{await fs.access(p);return true;}catch{return false;}}
async function androidEnvironment({required=false}={}) {
 const candidates=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,path.join(os.homedir(),'Library/Android/sdk'),'/opt/homebrew/share/android-commandlinetools','/usr/local/share/android-commandlinetools'].filter(Boolean);
 let sdk;
 for(const candidate of candidates)if(await exists(path.join(candidate,'platform-tools/adb'))){sdk=await fs.realpath(candidate);break;}
 const homes=['/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home','/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',process.env.JAVA_HOME,'/Applications/Android Studio.app/Contents/jbr/Contents/Home'].filter(Boolean);
 let javaHome;
 for(const home of homes)if(await exists(path.join(home,'bin/java'))){javaHome=await fs.realpath(home);break;}
 if(required&&!sdk)throw Error('未找到 Android SDK，请安装 SDK platform-tools，或配置 ANDROID_HOME 后重启 Ailo。');
 if(required&&!javaHome)throw Error('未找到可用 JDK，请安装 JDK 17 或配置 JAVA_HOME 后重启 Ailo。');
 return {sdk,javaHome};
}
module.exports={androidEnvironment,exists};
