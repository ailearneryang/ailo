import Foundation
import Speech
import AVFoundation
func send(_ type:String,_ text:String="") { let value:[String:String] = ["type":type,"text":text]; if let data=try? JSONSerialization.data(withJSONObject:value),let line=String(data:data,encoding:.utf8){print(line);fflush(stdout)} }
let locale=CommandLine.arguments.count>1 ? CommandLine.arguments[1] : "zh-CN"
if CommandLine.arguments.contains("--check") { send("capabilities", "offline-only; zh-CN,en-US; max60s");exit(0) }
let engine=AVAudioEngine()
let request=SFSpeechAudioBufferRecognitionRequest()
var task:SFSpeechRecognitionTask?
var ended=false
var tapped=false
func finish(_ error:String?=nil){if ended{return};ended=true;engine.stop();if tapped{engine.inputNode.removeTap(onBus:0);tapped=false};request.endAudio();task?.cancel();if let error=error{send("error",error)}else{send("end")};exit(error == nil ? 0 : 1)}
SFSpeechRecognizer.requestAuthorization { status in
 DispatchQueue.main.async {
  guard status == .authorized else {send("error","未获得语音识别权限，请在系统设置中允许 Ailo 使用语音识别。");exit(1)}
  AVCaptureDevice.requestAccess(for:.audio){ allowed in DispatchQueue.main.async {
   guard allowed else {send("error","麦克风权限未开启，请在系统设置中允许 Ailo 使用麦克风。");exit(1)}
   guard let recognizer=SFSpeechRecognizer(locale:Locale(identifier:locale)),recognizer.isAvailable else{send("error","当前语言的系统语音识别不可用。");exit(1)}
   guard recognizer.supportsOnDeviceRecognition else{send("error","此设备尚未提供该语言的离线听写。请在系统设置中启用并下载对应听写语言。");exit(1)}
   request.requiresOnDeviceRecognition=true
   request.shouldReportPartialResults=true
   let input=engine.inputNode
   let format=input.outputFormat(forBus:0)
   guard format.sampleRate>0 else{send("error","没有可用的麦克风。");exit(1)}
   input.installTap(onBus:0,bufferSize:1024,format:format){buffer,_ in request.append(buffer)}
   tapped=true
   task=recognizer.recognitionTask(with:request){result,error in
    if ended{return}
    if let result=result{send("text",result.bestTranscription.formattedString);if result.isFinal{finish()}}
    if let error=error{finish(error.localizedDescription)}
   }
   do{engine.prepare();try engine.start();send("ready")}catch{finish("无法启动麦克风："+error.localizedDescription)}
  }}
 }
}
DispatchQueue.global().async { while let line=readLine(){if line=="stop"{DispatchQueue.main.async{engine.stop();request.endAudio();DispatchQueue.main.asyncAfter(deadline:.now()+2){finish()}};return}};DispatchQueue.main.async{finish()} }
DispatchQueue.main.asyncAfter(deadline:.now()+60){engine.stop();request.endAudio();DispatchQueue.main.asyncAfter(deadline:.now()+2){finish()}}
RunLoop.main.run()
