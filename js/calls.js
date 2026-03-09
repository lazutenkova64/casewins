// ========== ЗВОНКИ (WebRTC) ==========
let currentCall = null;
let localStream = null;
let peerConnection = null;
let callRingtone = null;
let callAcceptedSound = null;
let callEndedSound = null;
let callModal = null;
let callMuted = false;
let callTimerInterval = null;
let callStartTime = null;
const CALL_DURATION_LIMIT = 30 * 60 * 1000;

async function preloadSounds() {
    return new Promise((resolve) => {
        callRingtone = new Audio();
        callRingtone.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//8kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        callRingtone.loop = true;
        
        callAcceptedSound = new Audio();
        callAcceptedSound.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//8kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        
        callEndedSound = new Audio();
        callEndedSound.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//8kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        
        setTimeout(resolve, 100);
    });
}

async function cleanupOldCalls() {
    if (!window.callsTableExists) return;
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        await supabaseClient
            .from('calls')
            .delete()
            .lt('created_at', fiveMinutesAgo);
    } catch (err) {
        console.error('Error cleaning up old calls:', err);
        if (err.code === 'PGRST116') {
            window.callsTableExists = false;
        }
    }
}

function getIceServers() {
    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    };
}

async function startCall() {
    if (!window.callsTableExists) {
        await checkCallsTable();
        if (!window.callsTableExists) {
            alert('Функция звонков недоступна.');
            return;
        }
    }
    if (!currentChat || currentChat.is_public) return;
    
    if (currentChat.pair_key === `${window.currentUser.id}_${window.currentUser.id}`) {
        alert('Нельзя звонить самому себе');
        return;
    }
    
    const otherId = currentChat.pair_key.split('_').find(id => id !== window.currentUser.id);
    const otherUser = window.allUsers.find(u => u.id === otherId);
    if (!otherUser) {
        alert('Не удалось определить собеседника');
        return;
    }
    const receiverId = otherUser.id;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        peerConnection = new RTCPeerConnection(getIceServers());
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        const callId = generateUUID();
        const timestamp = Date.now();
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && ably) {
                const userChannel = ably.channels.get(`user-${receiverId}`);
                userChannel.publish('ice-candidate', {
                    callId,
                    candidate: event.candidate,
                    senderId: window.currentUser.id,
                    timestamp: Date.now()
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track');
            const remoteStream = event.streams[0];
            const audioElement = document.createElement('audio');
            audioElement.srcObject = remoteStream;
            audioElement.autoplay = true;
            audioElement.controls = false;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            
            const playAudio = () => {
                audioElement.play().catch(e => console.warn('Play failed:', e));
                document.removeEventListener('click', playAudio);
            };
            document.addEventListener('click', playAudio, { once: true });
            
            document.getElementById('callStatus').textContent = 'В разговоре';
            if (!callTimerInterval) {
                startCallTimer();
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        const callRecord = {
            caller_id: window.currentUser.id,
            receiver_id: receiverId,
            status: 'calling',
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabaseClient
            .from('calls')
            .insert([callRecord])
            .select();
        
        if (error) throw error;
        
        const dbCallId = data[0].id;
        
        currentCall = {
            id: callId,
            dbId: dbCallId,
            receiverId,
            callerId: window.currentUser.id,
            callerName: window.currentUser.name,
            callerAvatar: window.currentUser.avatar,
            timestamp
        };
        
        if (ably) {
            const userChannel = ably.channels.get(`user-${receiverId}`);
            userChannel.publish('offer', {
                callId,
                dbCallId,
                offer,
                callerId: window.currentUser.id,
                callerName: window.currentUser.name,
                callerAvatar: window.currentUser.avatar,
                timestamp
            });
        }
        
        showOutgoingCallModal();
        
    } catch (err) {
        console.error('Error starting call:', err);
        alert('Не удалось начать звонок: ' + (err.message || 'проверьте консоль'));
    }
}

function showIncomingCallModal(callerName, callerAvatar, timestamp) {
    if (Date.now() - timestamp > 10000) {
        console.log('Ignoring old call', timestamp);
        return;
    }
    
    if (!callModal) return;
    
    document.getElementById('callStatus').textContent = 'Входящий звонок...';
    document.getElementById('callTimer').textContent = '';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('callAvatar').textContent = callerAvatar || '👤';
    document.getElementById('incomingCallControls').style.display = 'flex';
    document.getElementById('outgoingCallControls').style.display = 'none';
    
    document.getElementById('answerCallBtn').onclick = answerCall;
    document.getElementById('rejectCallBtn').onclick = rejectCall;
    document.getElementById('incomingMuteBtn').onclick = toggleMute;
    document.getElementById('incomingMuteBtn').classList.remove('muted');
    
    callModal.classList.add('active');
}

function showOutgoingCallModal() {
    if (!callModal) return;
    
    const otherId = currentChat.pair_key.split('_').find(id => id !== window.currentUser.id);
    const otherUser = window.allUsers.find(u => u.id === otherId);
    let displayName = otherUser ? otherUser.username : 'Пользователь';
    let avatar = otherUser ? (otherUser.avatar || '👤') : '👤';
    
    document.getElementById('callStatus').textContent = 'Соединение...';
    document.getElementById('callTimer').textContent = '';
    document.getElementById('callerName').textContent = displayName;
    document.getElementById('callAvatar').textContent = avatar;
    document.getElementById('incomingCallControls').style.display = 'none';
    document.getElementById('outgoingCallControls').style.display = 'flex';
    
    document.getElementById('endCallBtn').onclick = endCall;
    document.getElementById('muteCallBtn').onclick = toggleMute;
    document.getElementById('muteCallBtn').classList.remove('muted');
    
    callModal.classList.add('active');
}

function startCallTimer() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
        const elapsed = Date.now() - callStartTime;
        if (elapsed >= CALL_DURATION_LIMIT) {
            alert('Длительность звонка превысила 30 минут. Звонок завершён.');
            endCall();
            return;
        }
        document.getElementById('callTimer').textContent = formatCallTime(elapsed);
    }, 1000);
}

async function answerCall() {
    if (!currentCall || !peerConnection) return;
    
    if (Date.now() - currentCall.timestamp > 10000) {
        alert('Звонок устарел');
        endCall();
        return;
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(currentCall.offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if (currentCall.dbId) {
            await supabaseClient
                .from('calls')
                .update({ status: 'active' })
                .eq('id', currentCall.dbId);
        }
        
        if (ably) {
            const userChannel = ably.channels.get(`user-${currentCall.callerId}`);
            userChannel.publish('answer', {
                callId: currentCall.id,
                answer,
                timestamp: Date.now()
            });
        }
        
        document.getElementById('incomingCallControls').style.display = 'none';
        document.getElementById('outgoingCallControls').style.display = 'flex';
        document.getElementById('muteCallBtn').onclick = toggleMute;
        document.getElementById('muteCallBtn').classList.remove('muted');
        document.getElementById('callStatus').textContent = 'В разговоре';
        startCallTimer();
        
        if (callRingtone) {
            callRingtone.pause();
            callRingtone.currentTime = 0;
        }
        
        if (callAcceptedSound) {
            callAcceptedSound.play().catch(() => {});
        }
        
    } catch (err) {
        console.error('Error answering call:', err);
        alert('Не удалось ответить на звонок');
    }
}

async function rejectCall() {
    if (currentCall && ably) {
        const userChannel = ably.channels.get(`user-${currentCall.callerId}`);
        userChannel.publish('end', {
            callId: currentCall.id,
            timestamp: Date.now()
        });
        
        if (currentCall.dbId) {
            await supabaseClient
                .from('calls')
                .update({ status: 'ended' })
                .eq('id', currentCall.dbId);
        }
    }
    
    endCall();
}

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    
    if (callModal) {
        callModal.classList.remove('active');
    }
    
    if (callRingtone) {
        callRingtone.pause();
        callRingtone.currentTime = 0;
    }
    
    if (callEndedSound) {
        callEndedSound.play().catch(() => {});
    }
    
    currentCall = null;
}

function toggleMute() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    
    const enabled = !audioTracks[0].enabled;
    audioTracks.forEach(track => {
        track.enabled = enabled;
    });
    
    callMuted = !enabled;
    
    const muteBtn = document.getElementById('muteCallBtn');
    const incomingMuteBtn = document.getElementById('incomingMuteBtn');
    
    [muteBtn, incomingMuteBtn].forEach(btn => {
        if (btn) {
            if (callMuted) {
                btn.textContent = '🔴';
                btn.classList.add('muted');
            } else {
                btn.textContent = '🎤';
                btn.classList.remove('muted');
            }
        }
    });
}

function listenForIncomingCalls() {
    if (!ably || !window.currentUser) return;
    
    const userChannel = ably.channels.get(`user-${window.currentUser.id}`);
    
    userChannel.subscribe('offer', async (message) => {
        const { offer, callerId, callerName, callerAvatar, callId, dbCallId, timestamp } = message.data;
        
        if (Date.now() - timestamp > 10000) {
            console.log('Ignoring old call offer', timestamp);
            return;
        }
        
        if (currentCall) {
            userChannel.publish('end', { callId, timestamp: Date.now() });
            return;
        }
        
        peerConnection = new RTCPeerConnection(getIceServers());
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && ably) {
                userChannel.publish('ice-candidate', {
                    callId,
                    candidate: event.candidate,
                    senderId: window.currentUser.id,
                    timestamp: Date.now()
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track (incoming)');
            const remoteStream = event.streams[0];
            const audioElement = document.createElement('audio');
            audioElement.srcObject = remoteStream;
            audioElement.autoplay = true;
            audioElement.controls = false;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            
            const playAudio = () => {
                audioElement.play().catch(e => console.warn('Play failed:', e));
                document.removeEventListener('click', playAudio);
            };
            document.addEventListener('click', playAudio, { once: true });
            
            document.getElementById('callStatus').textContent = 'В разговоре';
            if (!callTimerInterval) {
                startCallTimer();
            }
        };
        
        currentCall = {
            id: callId,
            dbId: dbCallId,
            callerId,
            callerName,
            callerAvatar,
            offer,
            timestamp
        };
        
        showIncomingCallModal(callerName, callerAvatar, timestamp);
        
        if (!window.currentUser.dnd && callRingtone) {
            callRingtone.loop = true;
            callRingtone.play().catch(() => {});
        }
    });

    userChannel.subscribe('answer', async (message) => {
        const { answer, callId, timestamp } = message.data;
        if (!currentCall || currentCall.id !== callId) return;
        
        if (Date.now() - timestamp > 10000) {
            console.log('Ignoring old answer');
            return;
        }
        
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            document.getElementById('callStatus').textContent = 'В разговоре';
            startCallTimer();
            
            if (callAcceptedSound) {
                callAcceptedSound.play().catch(() => {});
            }
        } catch (err) {
            console.error('Error setting remote description:', err);
        }
    });

    userChannel.subscribe('ice-candidate', (message) => {
        const { candidate, callId, timestamp } = message.data;
        if (!currentCall || currentCall.id !== callId) return;
        
        if (Date.now() - timestamp > 10000) return;
        
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
            console.error('Error adding ICE candidate:', err);
        });
    });

    userChannel.subscribe('end', (message) => {
        const { callId, timestamp } = message.data;
        if (!currentCall || currentCall.id !== callId) return;
        
        endCall();
    });
}
