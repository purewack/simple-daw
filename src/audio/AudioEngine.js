


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

import * as Tone from 'tone'
import newid from 'uniqid';
import { randomColor } from '../Util';
import wavClickMinor from './metro_click_l.wav'
import wavClickMajor from './metro_click_h.wav'
//import MicWorkletModule from '../../public/MicWorkletModule'

const calculateRegionRelations = (regions) => {
  let sorted = regions.slice().sort((a,b)=>{
      if(a.rOffset < b.rOffset){
          return -1
      }
      else if(a.rOffset > b.rOffset){
          return 1
      }
      else return 0
  })
  
  return sorted
  // return sorted.map((r,i,a) => {
  //     r.rPrevId = (i>0 ? a[i-1].regionId : '')
  //     r.rNextId = (i<a.length-1 ? a[i+1].regionId : '')
  //     return r
  // })
}

export const AudioEngine = {
  isSetup: false,
  actx: null,
  tonejs: null,
  inputWorklet: true,
  micNode: null,
  isRecording: false,
  lastRecording: null,
  lastBufferId: null,
  bufferPool: [],
  connections: [],
  metronome: null,
  recordingStats: {
    startTimePress:0,
    startTimeReal:0,
    stopTimePress:0,
    stopTimeReal:0,
    startDelta:0,
    stopDelta:0,
    totalDelay:0,
    track:null,
    from:0,
  },
  onRecordingComplete: null,
  
  awaitPermission(){
    if(this.isSetup) return
    try{
      return new Promise((resolve, reject) => {
        if(navigator.mediaDevices === undefined) 
          reject()
        else 
          navigator.mediaDevices.getUserMedia({audio: true, video: false})
          .then(resolve)
          .catch(reject)
      })
    }
    catch(ex){
      return ex
    }
  },

  hasInputs(){
    return new Promise((resolve, reject) => {
      navigator.mediaDevices.enumerateDevices().then((devices)=>{
        let count = 0
        devices.forEach(d =>{
          if(d.kind === 'audioinput')
            count += 1
        })

        if(count)
          resolve(count)
        else
          reject()
      }).catch(()=>{
        reject()
      })
    })
  },

  getInputs(){
    return new Promise((resolve, reject) => {
      navigator.mediaDevices.enumerateDevices().then((devices)=>{
        resolve(devices)
      }).catch(()=>{
        reject()
      })
    })
  },

  async init(inputId) {
    if(this.isSetup) return null
    
    this.tonejs = Tone
    this.actx = Tone.context._context._nativeAudioContext

    this.metronome = {
      click_major: new this.tonejs.Player(),
      click_minor: new this.tonejs.Player(),
      volume: 1.0,
      mute: false,
    }

    this.metronome.click_major.toDestination()
    this.metronome.click_minor.toDestination()

    this.metronome.click_minor.load(wavClickMinor)
    this.metronome.click_major.load(wavClickMajor)

    this.inputWorklet = (this.actx?.audioWorklet?.addModule !== undefined)
    //this.inputWorklet = false
    this.isSetup = true
   
    if(!inputId) {
      await this.tonejs.start()
      return this.inputWorklet
    }

    let stream = await navigator.mediaDevices.getUserMedia({audio:{
  		deviceId: {exact: inputId},
      latency: 0.0,
  		echoCancellation: false,
  		mozNoiseSuppression: false,
  		mozAutoGainControl: false,
  	},video:false})

    if(this.inputWorklet){
      let micStream = this.actx.createMediaStreamSource(stream);
      await this.actx.audioWorklet.addModule('MicWorkletModule.js')
      
      let micNode = new window.AudioWorkletNode(this.actx, 'mic-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      })
      micStream.connect(micNode)
      micNode.connect(this.actx.destination)
      micNode.port.onmessage = (e)=>{
        if(e.data.eventType === 'onchunk'){
          let len = (e.data.audioChunk.length + this.lastRecording.length)
          let bufnew = new Float32Array(len)
          bufnew.set(this.lastRecording)
          bufnew.set(e.data.audioChunk, this.lastRecording.length)
          this.lastRecording = bufnew
        }
        else if(e.data.eventType === 'begin'){
          this.lastRecording = new Float32Array(4096)
          this.recordingStats.startTimeReal = performance.now() 
          this.recordingStats.startDelta = this.recordingStats.startTimeReal-this.recordingStats.startTimePress
        }
        else if(e.data.eventType === 'end'){
          const buf = this.actx.createBuffer(1,e.data.recLength, this.actx.sampleRate)
          buf.copyToChannel(Float32Array.from(this.lastRecording),0) 
          this.constructRecording(buf)
        }
      }
      this.micNode = micNode
      await this.tonejs.start()
      
    }
    else{
      this.micNode = new MediaRecorder(stream)
      this.micNode.ondataavailable = (e)=>{
        if(e.data.size){
          this.lastRecording = e.data
        }
      }
      this.micNode.onstart = ()=>{ 
        this.recordingStats.startTimeReal = performance.now() 
        this.recordingStats.startDelta = this.recordingStats.startTimeReal-this.recordingStats.startTimePress
      }
      this.micNode.onstop = (e)=>{
        console.log(this.lastRecording)
        let url = window.URL.createObjectURL(this.lastRecording)
        this.constructRecording(url)
      }
      await this.tonejs.start()
    }

    return this.inputWorklet
  },

  constructRecording(data){
    console.log(data)
    this.recordingStats.stopTimeReal = performance.now()
    this.recordingStats.stopDelta = this.recordingStats.stopTimeReal - this.recordingStats.stopTimePress
    this.recordingStats.totalDelay = (this.recordingStats.startDelta + this.recordingStats.stopDelta)
    console.log(this.recordingStats)

    const id = newid()

    const onload = (b)=>{
      console.log(b)
      const recording = {
        id: id, 
        durationSeconds: b.duration - this.recordingStats.totalDelay/1000
      }
      this.onRecordingComplete(recording, this.recordingStats.track, this.recordingStats.from, this.getBPS())
    }

    const newRecording = {
      id: id,
      bufferData: new this.tonejs.ToneAudioBuffer(data, onload),
      online: true,
      startDeltaSec: this.recordingStats.startDelta/1000,
      stopDeltaSec: this.recordingStats.stopDelta/1000,
      totalDelay: this.recordingStats.totalDelay/1000,
      initialBPM: this.tonejs.Transport.bpm.value,
    }
    console.log(newRecording)
    this.bufferPool.push(newRecording)

    if(typeof data !== 'string') onload(data)
  },

  setBPM(bpm){
    if(this.tonejs)
    this.tonejs.Transport.bpm.value = bpm
  },

  getBPM(){ 
    if(this.tonejs)
    return this.tonejs.Transport.bpm.value
    else 
    return 60
  },

  getBPS(){
    if(this.tonejs)
    return this.tonejs.Transport.bpm.value/60
    else
    return 1.0
  },

  transportRecordStart (trackId, tracks, from) {
    if(!this.isRecording && trackId){
      this.tonejs.Transport.schedule((t)=>{
        this.isRecording = trackId
        this.recordingStats.from = from
        this.recordingStats.startTimePress = performance.now()
        if(this.inputWorklet){
          this.micNode.parameters.get('recState').setValueAtTime(1, 0); 
        }
        else{
          this.micNode.start()
        }
      }, 0)

      this.transportPlay(trackId, tracks, from)
      console.log('started')
    }
  },
  transportRecordStop (trackId,tracks) {

    if(this.isRecording && trackId){
      
      this.recordingStats.stopTimePress = performance.now()
      this.recordingStats.track = trackId
      
      this.transportStop(tracks)

      if(this.inputWorklet)
        this.micNode.parameters.get('recState').setValueAtTime(0, 0)
      else
        this.micNode.stop()

    }

  },
  transportStop(tracks){
    
    this.tonejs.Transport.stop()
    this.tonejs.Transport.cancel()
    tracks.forEach(tr => {
      tr.player.stop()
      //tr.envelope.cancel()
    })
    
  },
  transportPlay(omitTrackId, tracks, from){
   // if(this.actx === null) return;
    
    if(this.tonejs.Transport.state !== 'stopped'){
      this.transportStop(tracks)
      return;
    }

    this.schedule(tracks, omitTrackId, from)
    
    this.tonejs.Transport.seconds = 0
    this.tonejs.Transport.start('+0.1')
          
  },

  schedule(tracks, omitTrackId, from){
    //const tt = durationMultiplier
    //const tt = 1.0
    const ltc = 0.128

    tracks.forEach(tr => {
      if(!tr.regions) return
      if(omitTrackId && tr.trackId === omitTrackId) return

      const bpm = this.tonejs.Transport.bpm.value 
      const bTimeScalar = 60/bpm

      tr.regions.forEach(reg => {
        this.tonejs.Transport.schedule(t => {
            this.bufferPool.forEach(bp => {
              if(bp.id === reg.bufferId){
                tr.player.buffer = bp.bufferData

                const ltc_start = bp.startDeltaSec+ltc
                const ltc_dur = bp.stopDeltaSec+ltc

                const bpmPlayrate = bpm / bp.initialBPM
                tr.player.playbackRate = reg.rPlayrate*bpmPlayrate

                tr.player.start(
                  t, 
                  ltc_start + reg.bOffset*bTimeScalar , 
                  ltc_dur + reg.rDuration*bTimeScalar 
                )
              }
            })
            // tr.envelope.attack = reg.timeFadeIn
            // tr.envelope.release = reg.timeFadeOut
            // tr.envelope.triggerAttackRelease(reg.rDuration - reg.timeFadeOut)
        }, reg.rOffset*bTimeScalar )
      })
    })

    if(this.metronome.volume !== 0.0){
      let b = 0
      this.tonejs.Transport.scheduleRepeat((time)=>{
        if(this.metronome.mute) return
        if(b%4 === 0)
        this.metronome.click_major.start(time)
        else
        this.metronome.click_minor.start(time)

        b+=1
      }, '4n')
    }
  },
  
  newTrack(){
    const t = {
        trackId: newid(),
        volume: 1.0,
        enable: 1.0,
        regions: [],
        color: randomColor(),
        player: new this.tonejs.Player(),
        // envelope: new this.tonejs.AmplitudeEnvelope({
        //   attack:0,
        //   decay:0,
        //   sustain:1,
        //   release:0,
        // }),
    }
    t.player.toDestination()
    //t.player.connect(t.envelope)
    // t.envelope.toDestination()
    return t
  },

  newRegion(bufferId, offset, durationBeat, durationRecord){
    //this.bufferPool = [...this.bufferPool, {bufferId,duration}]

    return {
      regionId: newid(),
      bufferId: bufferId,
      bOffset:0,
      bDuration:durationRecord,
      rOffset:offset,
      rDuration:durationBeat,
      rFadeIn: 0.0,
      rFadeOut: 0.0,
      rPlayrate:1.0,
      bpmPlayrate: 1.0,
    }
  },

  cloneRegion(clonee){
    return {...clonee}
  },

  pushRegion(regions,region){
    return calculateRegionRelations([...regions,region])
  },

  setRegions(regions){
    return calculateRegionRelations(regions)
  },
  updateRegion(regions,region){
    return calculateRegionRelations(regions.map(r =>{
      if(r.regionId === region.regionId)
      return region
      else
      return r
    }))
  },
  
  removeRegion(regions,region){
    let idx = null
    regions.forEach((r,i) => {
      if(r.regionId === region.regionId)
        idx = i
    })

    if(idx !== null)
      return calculateRegionRelations( regions.filter((r,i) => {return i !== idx}))
    else
    return regions
  }
};
