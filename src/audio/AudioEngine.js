
// const init=()=>{
    
//     navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(stream => {
//         console.log('permission granted')
        
//         const startWorklet = async ()=>{
//         console.log('setup mic-processor worklet')
//         let mikeNode = ac.createMediaStreamSource(stream);
        
//         await ac.audioWorklet.addModule('./MicWorklet.js').then(()=>{
            
//         })
//         let mikeProcess = new window.AudioWorkletNode(ac, 'mic-worklet')
//         mikeNode.connect(mikeProcess)
        
//         mikeProcess.port.onmessage = (e)=>{
//             if(e.data.eventType === 'data'){
//             //console.log(e.data.audioBuffer)
//             recorderChunks.current.push(e.data.audioBuffer)
//             }
//         }
        
//         micProcess.current = mikeProcess
//         }
//         startWorklet()
//     })
    
// }


// const rollTransport = ()=>{
//     Tone.Transport.stop()
//     Tone.Transport.scheduleRepeat(t=>{
//       setTransport(Tone.Transport.position)
//     },'16n',0)
//     Tone.Transport.seconds = 0
//     Tone.Transport.start()
//   }

//   const recHandle = ()=>{
//     if(armedIndex === null) return
    
//     if(micProcess.current.parameters.get('isRecording')){
//       micProcess.current.parameters.get('isRecording').setValueAtTime(0, 0);
//       let source = URL.createObjectURL(new Blob(recorderChunks.current))
//       console.log(source)

//       let track = tracks[armedIndex]
//       track.buffers.push(new Tone.ToneAudioBuffer(source, (buffer)=>{
//         track.player.buffer = buffer
//       }))
//       setRecording(false)
//     }
//     else{
//       playHandle()
//       recorderChunks.current = []
//       micProcess.current.parameters.get('isRecording').setValueAtTime(1, 0);
      
//       setRecording(true)
//     }
//   }
//   const stopHandle =()=>{
//     if(Tone.Transport.state === 'started'){
//       tracks.forEach(t=>{
//         t.player.stop()
//       })
//       Tone.Transport.stop()
//     }
//   }
//   const playHandle = ()=>{
//     if(Tone.Transport.state !== 'started'){

//       //start all tracks that have a recording
//       Tone.Transport.cancel()
//       console.log('start transport')
//       tracks.forEach(t=>{
//         if(t.player.loaded){
//           Tone.Transport.scheduleOnce(()=>{
//               t.player.start()
//           },'0:0:0')
//         }
//       })
//       rollTransport()
//     }
//     setRecording(false)
//   }

//   const beginHandler = ()=>{
//     const startTone = async ()=>{
//       ac = new AudioContext()
//       await Tone.start().then(()=>{
//         console.log('started')
//         console.log('start and clear tracks')
//         setTracks([])
//         addTrack()
//         addTrack()
//         addTrack()
//         setBegun(true)
//       })
//     }
//     startTone()
//   }

import * as Tone from 'tone'

export const AudioEngine = {
  ac: null,
  tonejs: null,
  micNode: null,
  lastRecordingChunks: null,
  player: null,
  bufferPool: null,
  lastURL: null,
  init() {
    let ac = this.ac  = new AudioContext({ latencyHint: 'interactive' });
    Tone.setContext(ac) 
    this.tonejs = Tone;
	this.bufferPool = []
    this.player = new Tone.Player().toDestination()

	console.log(ac.baseLatency)

    navigator.mediaDevices.getUserMedia({audio:{
		latency: 0.0,
		echoCancellation: false,
		mozNoiseSuppression: false,
		mozAutoGainControl: false
	},video:false}).then(stream => {
        console.log('permission granted')
        
        const startWorklet = async ()=>{
          console.log('setup mic-processor worklet')
          let mikeNode = ac.createMediaStreamSource(stream);
          await ac.resume()
          await ac.audioWorklet.addModule('MicWorkletModule.js')

          let mikeProcess = new window.AudioWorkletNode(ac, 'mic-worklet')
          mikeNode.connect(mikeProcess)
		  mikeProcess.connect(ac.destination)
          
          mikeProcess.port.onmessage = (e)=>{
              if(e.data.eventType === 'onchunk'){
                this.lastRecordingChunks.push(e.data.audioChunk)
				console.log('data')
              }
              else if(e.data.eventType === 'begin'){
				this.lastRecordingChunks = []
			  }
              else if(e.data.eventType === 'end'){
				let url = URL.createObjectURL(new Blob(this.lastRecordingChunks))
				this.lastURL = url;
				console.log(url)
		
				this.bufferPool.push(new Tone.ToneAudioBuffer(url, (buffer)=>{
					console.log(buffer)
					this.player.buffer = buffer
				}))
              }
          }
          this.micNode = mikeProcess
        }
        startWorklet()
    })
  },
  record () {
    if(this.ac === null) return;

    let recState = (this.micNode.parameters.get('recState').value > 0)
    
    if(!recState){
      	this.micNode.parameters.get('recState').setValueAtTime(1, 0);
    }
	else{
	  	this.micNode.parameters.get('recState').setValueAtTime(0, 0);
    }

	return !recState
  },
  transportPlay(){
    if(this.ac === null) return;
    this.player.start()
  },
  transportStop(){
    if(this.ac === null) return;


  },
};
