// Состояние сообщений
let messages = {};
let unreadCounts = {};
let messageStatuses = {};
let deletedMessages = {};
let pendingMessages = {};
let messageQueue = {};

let lastMessageTime = 0;
const MESSAGE_COOLDOWN = 500;
let sendBtnDisabled = false;

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let recordingTimeout;
let mediaStream = null;
let recordingStartTime = 0;

let activeAudio = null;
let activeAudioId = null;
let audioElements = {};
let audioUpdateInterval = null;

// Загрузка всех сообщений
async function loadAllMessages() {
    if (!currentUser) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            data.forEach(msg => {
                const chatId = msg.chat_id;
                
                if (deletedMessages[chatId]?.includes(msg.id)) return;
                
                if (!messages[chatId]) messages[chatId] = [];
                
                const exists = messages[chatId].some(m => m.id === msg.id);
                if (!exists) {
                    const sender = window.allUsers?.find(u => u.id === msg.sender_id) || 
                                 { username: 'Неизвестно', avatar: '👤' };
                    
                    messages[chatId].push({
                        id: msg.id,
                        chatId: msg.chat_id,
                        sender: msg.sender_id,
                        senderName: sender.username,
                        text: msg.text,
                        audio: msg.audio,
                        duration: msg.duration,
                        time: msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
                        isAdmin: sender.username === ADMIN_USERNAME,
                        edited: msg.edited || false,
                        type: msg.sender_id === currentUser.id ? 'out' : 'in'
                    });
                    
                    if (msg.sender_id === currentUser.id && !messageStatuses[msg.id]) {
                        messageStatuses[msg.id] = {
                            status: 'sent',
                            deliveredAt: null,
                            readAt: null
                        };
                    }
                }
            });
            
            Object.keys(messages).forEach(chatId => {
                messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            });
            
            updateUnreadCounts();
        }
    } catch (err) {
        console.error('Error loading all messages:', err);
    }
}

// Загрузка истории чата
async function loadChatHistory(chatId) {
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            if (!messages[chatId]) messages[chatId] = [];
            
            data.forEach(msg => {
                if (deletedMessages[chatId]?.includes(msg.id)) return;
                
                const exists = messages[chatId].some(m => m.id === msg.id);
                if (!exists) {
                    const sender = window.allUsers?.find(u => u.id === msg.sender_id) || 
                                 { username: 'Неизвестно', avatar: '👤' };
                    
                    messages[chatId].push({
                        id: msg.id,
                        chatId: msg.chat_id,
                        sender: msg.sender_id,
                        senderName: sender.username,
                        text: msg.text,
                        audio: msg.audio,
                        duration: msg.duration,
                        time: msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
                        isAdmin: sender.username === ADMIN_USERNAME,
                        edited: msg.edited || false,
                        type: msg.sender_id === currentUser.id ? 'out' : 'in'
                    });
                    
                    if (msg.sender_id === currentUser.id && !messageStatuses[msg.id]) {
                        messageStatuses[msg.id] = {
                            status: 'sent',
                            deliveredAt: null,
                            readAt: null
                        };
                    }
                }
            });
            
            messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            if (currentChat?.id === chatId) {
                renderMessages();
            }
        }
    } catch (err) {
        console.error('Ошибка при загрузке истории:', err);
    }
}

// Отправка текстового сообщения
async function sendMessage() {
    if (sendBtnDisabled) {
        alert('Слишком часто! Подождите секунду.');
        return;
    }

    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!currentChat) {
        alert('Сначала выберите чат');
        return;
    }
    if (!text) return;
    
    disableSendButton();

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timestamp = now.getTime();
    const tempId = generateUUID();
    
    const localMessage = {
        id: tempId,
        chatId: currentChat.id,
        sender: currentUser.id,
        senderName: currentUser.name,
        text: text,
        time: timeString,
        timestamp: timestamp,
        isAdmin: currentUser.isAdmin,
        edited: false,
        type: 'out'
    };
    
    if (!messages[currentChat.id]) messages[currentChat.id] = [];
    messages[currentChat.id].push(localMessage);
    messages[currentChat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    messageStatuses[tempId] = { status: 'sent', sentAt: timestamp };
    saveMessageStatuses();
    
    input.value = '';
    input.style.height = 'auto';
    
    renderMessages();
    window.updateChatsList?.();
    window.forceShowInput?.();
    
    const dbMessage = {
        chat_id: currentChat.id,
        sender_id: currentUser.id,
        text: text,
        created_at: now.toISOString()
    };
    
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .insert([dbMessage])
            .select();
        
        if (error) {
            console.error('Ошибка сохранения сообщения:', error);
            if (!pendingMessages[currentUser.id]) pendingMessages[currentUser.id] = [];
            pendingMessages[currentUser.id].push({ ...dbMessage, tempId });
            localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
        } else {
            const realId = data[0].id;
            const msgIndex = messages[currentChat.id].findIndex(m => m.id === tempId);
            if (msgIndex !== -1) {
                messages[currentChat.id][msgIndex].id = realId;
            }
            messageStatuses[realId] = messageStatuses[tempId];
            delete messageStatuses[tempId];
            saveMessageStatuses();
            
            if (window.ably && !currentChat.is_public && !currentChat.isFavorite) {
                const chatChannel = window.ably.channels.get(`chat-${currentChat.id}`);
                chatChannel.publish('message', { 
                    ...dbMessage, 
                    id: realId, 
                    sender_name: currentUser.name 
                }, (err) => {
                    if (err) {
                        console.error('Failed to publish message to Ably', err);
                        const otherUserId = currentChat.name.split('_').find(name => name !== currentUser.name);
                        const otherUser = window.allUsers?.find(u => u.username === otherUserId);
                        if (otherUser) {
                            addToMessageQueue(otherUser.id, { 
                                ...dbMessage, 
                                id: realId, 
                                sender_name: currentUser.name 
                            });
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Ошибка при сохранении:', err);
        if (!pendingMessages[currentUser.id]) pendingMessages[currentUser.id] = [];
        pendingMessages[currentUser.id].push({ ...dbMessage, tempId });
        localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
    }
}

// Отправка голосового сообщения
async function sendAudioMessage(audioBlob, duration) {
    if (!currentChat) {
        alert('Сначала выберите чат');
        return;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tempId = generateUUID();
    const timestamp = now.getTime();

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        const base64Audio = reader.result;

        const localMessage = {
            id: tempId,
            chatId: currentChat.id,
            sender: currentUser.id,
            senderName: currentUser.name,
            audio: base64Audio,
            duration: duration,
            time: timeString,
            timestamp: timestamp,
            isAdmin: currentUser.isAdmin,
            edited: false,
            type: 'out'
        };

        if (!messages[currentChat.id]) messages[currentChat.id] = [];
        messages[currentChat.id].push(localMessage);
        messages[currentChat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        messageStatuses[tempId] = { status: 'sent', sentAt: timestamp };
        saveMessageStatuses();
        
        renderMessages();
        window.updateChatsList?.();
        window.forceShowInput?.();

        const dbMessage = {
            chat_id: currentChat.id,
            sender_id: currentUser.id,
            audio: base64Audio,
            duration: duration,
            created_at: now.toISOString()
        };

        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .insert([dbMessage])
                .select();
            
            if (error) {
                console.error('Ошибка сохранения аудио:', error);
                if (!pendingMessages[currentUser.id]) pendingMessages[currentUser.id] = [];
                pendingMessages[currentUser.id].push({ ...dbMessage, tempId });
                localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
            } else {
                const realId = data[0].id;
                const msgIndex = messages[currentChat.id].findIndex(m => m.id === tempId);
                if (msgIndex !== -1) {
                    messages[currentChat.id][msgIndex].id = realId;
                }
                messageStatuses[realId] = messageStatuses[tempId];
                delete messageStatuses[tempId];
                saveMessageStatuses();
                
                if (window.ably && !currentChat.is_public && !currentChat.isFavorite) {
                    const chatChannel = window.ably.channels.get(`chat-${currentChat.id}`);
                    chatChannel.publish('message', { 
                        ...dbMessage, 
                        id: realId, 
                        sender_name: currentUser.name 
                    }, (err) => {
                        if (err) {
                            console.error('Failed to publish audio message to Ably', err);
                            const otherUserId = currentChat.name.split('_').find(name => name !== currentUser.name);
                            const otherUser = window.allUsers?.find(u => u.username === otherUserId);
                            if (otherUser) {
                                addToMessageQueue(otherUser.id, { 
                                    ...dbMessage, 
                                    id: realId, 
                                    sender_name: currentUser.name 
                                });
                            }
                        }
                    });
                }
            }
        } catch (err) {
            console.error('Ошибка при сохранении аудио:', err);
            if (!pendingMessages[currentUser.id]) pendingMessages[currentUser.id] = [];
            pendingMessages[currentUser.id].push({ ...dbMessage, tempId });
            localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
        }
    };
}

// Обработка очереди сообщений
async function sendPendingMessages() {
    if (!currentUser || !pendingMessages[currentUser.id]) return;
    
    const pending = pendingMessages[currentUser.id];
    if (pending.length === 0) return;
    
    for (const item of pending) {
        const { tempId, ...dbMessage } = item;
        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .insert([dbMessage])
                .select();
            
            if (!error) {
                const realId = data[0].id;
                for (const chatId in messages) {
                    const msgIndex = messages[chatId]?.findIndex(m => m.id === tempId);
                    if (msgIndex !== -1 && msgIndex !== undefined) {
                        messages[chatId][msgIndex].id = realId;
                        messageStatuses[realId] = messageStatuses[tempId];
                        delete messageStatuses[tempId];
                        saveMessageStatuses();
                        break;
                    }
                }
            }
        } catch (err) {
            console.error('Ошибка при отправке ожидающего сообщения:', err);
        }
    }
    
    delete pendingMessages[currentUser.id];
    localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
}

function processMessageQueue() {
    if (!window.ably || !currentUser) return;
    
    Object.keys(messageQueue).forEach(userId => {
        const userOnline = window.onlineUsers?.[userId]?.online;
        if (userOnline) {
            sendQueuedMessagesToUser(userId);
        }
    });
}

function addToMessageQueue(userId, message) {
    if (!messageQueue[userId]) messageQueue[userId] = [];
    messageQueue[userId].push(message);
    localStorage.setItem('messageQueue', JSON.stringify(messageQueue));
}

function sendQueuedMessagesToUser(userId) {
    if (!messageQueue[userId] || messageQueue[userId].length === 0) return;
    
    const messagesToSend = [...messageQueue[userId]];
    delete messageQueue[userId];
    localStorage.setItem('messageQueue', JSON.stringify(messageQueue));
    
    messagesToSend.forEach(message => {
        if (window.ably) {
            const chatChannel = window.ably.channels.get(`chat-${message.chat_id}`);
            chatChannel.publish('message', message);
        }
    });
}

// Удаление сообщения
function deleteMessage(messageId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentChat) return;
    
    const msg = messages[currentChat.id]?.find(m => m.id === messageId);
    if (!msg) return;
    
    if (!currentUser.isAdmin && msg.sender != currentUser.id) {
        alert('Вы можете удалять только свои сообщения');
        return;
    }
    
    if (!confirm('Удалить сообщение?')) return;
    
    if (!deletedMessages[currentChat.id]) deletedMessages[currentChat.id] = [];
    if (!deletedMessages[currentChat.id].includes(messageId)) {
        deletedMessages[currentChat.id].push(messageId);
        localStorage.setItem('deletedMessages', JSON.stringify(deletedMessages));
    }
    
    messages[currentChat.id] = messages[currentChat.id].filter(m => m.id !== messageId);
    
    supabaseClient
        .from('messages')
        .delete()
        .eq('id', messageId)
        .then(({ error }) => {
            if (error) console.error('Error deleting message from DB:', error);
        });
    
    if (window.ably && !currentChat.is_public && !currentChat.isFavorite) {
        const chatChannel = window.ably.channels.get(`chat-${currentChat.id}`);
        chatChannel.publish('delete', { messageId, senderId: currentUser.id });
    }
    
    window.hideMessageActions?.();
    renderMessages();
    window.updateChatsList?.();
    window.forceShowInput?.();
}

// Редактирование сообщения
let messageToEdit = null;

function editMessage(messageId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentChat) return;
    
    const msg = messages[currentChat.id]?.find(m => m.id === messageId);
    if (!msg) return;
    
    if (msg.sender != currentUser.id) {
        alert('Вы можете редактировать только свои сообщения');
        return;
    }
    
    messageToEdit = msg;
    document.getElementById('editMessageText').value = msg.text || '';
    document.getElementById('editMessageModal').classList.add('active');
    window.hideMessageActions?.();
}

function saveEditedMessage() {
    const newText = document.getElementById('editMessageText').value.trim();
    if (!newText || !messageToEdit || !currentChat) return;
    
    const msgIndex = messages[currentChat.id].findIndex(m => m.id === messageToEdit.id);
    if (msgIndex !== -1) {
        messages[currentChat.id][msgIndex].text = newText;
        messages[currentChat.id][msgIndex].edited = true;
        
        supabaseClient
            .from('messages')
            .update({ text: newText, edited: true })
            .eq('id', messageToEdit.id)
            .then(({ error }) => {
                if (error) console.error('Error updating message in DB:', error);
            });
        
        if (window.ably && !currentChat.is_public && !currentChat.isFavorite) {
            const chatChannel = window.ably.channels.get(`chat-${currentChat.id}`);
            chatChannel.publish('edit', { 
                messageId: messageToEdit.id, 
                newText, 
                editor: currentUser.id
            });
        }
        
        renderMessages();
        closeEditMessageModal();
    }
}

function closeEditMessageModal() {
    document.getElementById('editMessageModal').classList.remove('active');
    document.getElementById('editMessageText').value = '';
    messageToEdit = null;
}

// Рендер сообщений
function renderMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    const oldScrollHeight = container.scrollHeight;
    const oldScrollTop = container.scrollTop;
    const isAtBottom = oldScrollHeight - oldScrollTop - container.clientHeight < 50;
    
    let newMessages = '';
    
    if (!currentChat) {
        newMessages = '<div class="empty-state">👈 Выберите чат</div>';
    } else if (!messages[currentChat.id] || messages[currentChat.id].length === 0) {
        newMessages = '<div class="empty-state">Нет сообщений</div>';
    } else {
        messages[currentChat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        const fragment = [];
        
        messages[currentChat.id].forEach(msg => {
            if (deletedMessages[currentChat.id]?.includes(msg.id)) return;
            
            const status = messageStatuses[msg.id] || { status: msg.sender == currentUser.id ? 'sent' : 'delivered' };
            
            let content = '';
            let statusHtml = '';
            
            if (msg.type === 'out') {
                statusHtml = `<span class="message-status"><span class="status-icon ${status.status}">${status.status === 'read' ? '✓✓' : '✓'}</span></span>`;
            }
            
            if (msg.text) {
                content = `<div class="message-bubble">${escapeHtml(msg.text)}${msg.edited ? ' <span style="font-size: 10px; opacity: 0.7;">(ред.)</span>' : ''}</div>`;
            } else if (msg.audio) {
                const messageId = msg.id;
                const duration = msg.duration || 0;
                
                content = `
                    <div class="message-bubble audio-message">
                        <div class="audio-player">
                            <button class="play-pause-btn" data-message-id="${messageId}" onclick="toggleAudio('${messageId}', '${msg.audio}')">▶️</button>
                            <div class="audio-progress-container">
                                <div class="audio-progress-bar" onclick="seekAudio('${messageId}', event)">
                                    <div class="audio-progress-fill" data-message-id="${messageId}" style="width: 0%"></div>
                                </div>
                                <div class="audio-time-container">
                                    <span class="audio-current-time" data-message-id="${messageId}">0:00</span>
                                    <span class="audio-duration" data-message-id="${messageId}">${formatTime(duration)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            const canDelete = currentUser.isAdmin || msg.sender == currentUser.id;
            const canEdit = msg.sender == currentUser.id;
            
            let actions = '';
            if (canDelete || canEdit) {
                actions = `
                    <div class="message-actions" data-message-id="${msg.id}">
                        ${canEdit ? `<button class="message-action-btn" onclick="editMessage('${msg.id}', event)">✏️</button>` : ''}
                        ${canDelete ? `<button class="message-action-btn delete" onclick="deleteMessage('${msg.id}', event)">🗑️</button>` : ''}
                    </div>
                `;
            }
            
            fragment.push(`
                <div class="message ${msg.type}" data-id="${msg.id}" onclick="showMessageActions('${msg.id}', event)">
                    ${actions}
                    ${msg.type === 'in' ? `<div class="message-sender">${escapeHtml(msg.senderName)}</div>` : ''}
                    ${content}
                    <div class="message-footer">
                        <span class="message-time">${msg.time}</span>
                        ${statusHtml}
                    </div>
                </div>
            `);
        });
        
        newMessages = fragment.join('');
    }
    
    container.innerHTML = newMessages;
    
    if (isAtBottom) {
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
    }
    
    markMessagesAsRead(currentChat?.id);
    updateUnreadCounts();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Статусы сообщений
function markMessagesAsRead(chatId) {
    if (!window.ably || !messages[chatId] || !currentChat || currentChat.is_public || currentChat.isFavorite) return;
    
    let changed = false;
    messages[chatId].forEach(msg => {
        if (msg.sender != currentUser.id && 
            (!messageStatuses[msg.id] || messageStatuses[msg.id].status !== 'read')) {
            
            if (!messageStatuses[msg.id]) {
                messageStatuses[msg.id] = { status: 'read', readAt: Date.now() };
            } else {
                messageStatuses[msg.id].status = 'read';
                messageStatuses[msg.id].readAt = Date.now();
            }
            changed = true;
            
            const chatChannel = window.ably.channels.get(`chat-${chatId}`);
            chatChannel.publish('read_receipt', { 
                messageId: msg.id, 
                reader: currentUser.id
            });
        }
    });
    
    if (changed) {
        saveMessageStatuses();
    }
}

function updateUnreadCounts() {
    if (!currentUser) return;
    
    Object.keys(messages).forEach(chatId => {
        if (currentChat && chatId === currentChat.id) {
            unreadCounts[chatId] = 0;
        } else {
            let count = 0;
            messages[chatId]?.forEach(msg => {
                if (msg.sender !== currentUser.id && 
                    (!messageStatuses[msg.id] || messageStatuses[msg.id].status !== 'read')) {
                    count++;
                }
            });
            unreadCounts[chatId] = count;
        }
    });
}

// Загрузка и сохранение статусов
function loadMessageStatuses() {
    try {
        const saved = localStorage.getItem('messageStatuses');
        if (saved) {
            messageStatuses = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load message statuses', e);
    }
}

function saveMessageStatuses() {
    try {
        localStorage.setItem('messageStatuses', JSON.stringify(messageStatuses));
    } catch (e) {
        console.error('Failed to save message statuses', e);
    }
}

// Запись аудио
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    const messageInput = document.getElementById('messageInput');
    
    if (messageInput.value.trim().length > 0) return;
    if (!currentChat) {
        alert('Сначала выберите чат');
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает запись аудио');
        return;
    }
    
    recordingStartTime = Date.now();
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaStream = stream;
            
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                mimeType = 'audio/ogg;codecs=opus';
            }
            
            try {
                mediaRecorder = new MediaRecorder(stream, { mimeType });
            } catch (e) {
                mediaRecorder = new MediaRecorder(stream);
            }
            
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const duration = Math.round((Date.now() - recordingStartTime) / 1000);
                
                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }
                
                if (audioBlob.size > 0 && duration > 0.1) {
                    await sendAudioMessage(audioBlob, duration);
                }
                
                document.getElementById('micBtn').classList.remove('recording');
            };

            mediaRecorder.start();
            isRecording = true;
            document.getElementById('micBtn').classList.add('recording');
            
            recordingTimeout = setTimeout(() => {
                if (isRecording) stopRecording();
            }, 60000);
        })
        .catch(err => {
            console.error('Microphone access error:', err);
            alert('Не удалось получить доступ к микрофону');
        });
}

function stopRecording() {
    if (!isRecording) return;
    
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }
    }
}

// Воспроизведение аудио
function toggleAudio(messageId, audioSrc) {
    if (!audioElements[messageId]) {
        try {
            audioElements[messageId] = new Audio(audioSrc);
            
            audioElements[messageId].ontimeupdate = () => updateAudioProgress(messageId);
            
            audioElements[messageId].onended = () => {
                updateAudioButton(messageId, false);
                updateAudioProgress(messageId);
            };
            
            audioElements[messageId].onpause = () => {
                updateAudioButton(messageId, false);
            };
            
            audioElements[messageId].onplay = () => {
                updateAudioButton(messageId, true);
            };
            
            audioElements[messageId].onerror = (e) => {
                console.error('Audio playback error:', e);
                alert('Ошибка воспроизведения аудио.');
            };
        } catch (e) {
            console.error('Error creating audio element:', e);
            alert('Не удалось создать аудио элемент');
            return;
        }
    }
    
    const audio = audioElements[messageId];
    
    if (activeAudioId === messageId && activeAudio) {
        if (!activeAudio.paused) {
            activeAudio.pause();
            updateAudioButton(messageId, false);
        } else {
            activeAudio.play().catch(e => {
                console.error('Play failed:', e);
                alert('Не удалось воспроизвести аудио');
            });
            updateAudioButton(messageId, true);
        }
        return;
    }
    
    if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        updateAudioButton(activeAudioId, false);
    }
    
    activeAudio = audio;
    activeAudioId = messageId;
    
    activeAudio.play().catch(e => {
        console.error('Audio play error:', e);
        alert('Не удалось воспроизвести аудио');
    });
    updateAudioButton(messageId, true);
}

function updateAudioButton(messageId, isPlaying) {
    const btn = document.querySelector(`.play-pause-btn[data-message-id="${messageId}"]`);
    if (btn) {
        btn.innerHTML = isPlaying ? '⏸️' : '▶️';
        if (isPlaying) {
            btn.classList.add('playing');
        } else {
            btn.classList.remove('playing');
        }
    }
}

function updateAudioProgress(messageId) {
    const audio = audioElements[messageId];
    if (!audio) return;
    
    const progressFill = document.querySelector(`.audio-progress-fill[data-message-id="${messageId}"]`);
    const currentTimeSpan = document.querySelector(`.audio-current-time[data-message-id="${messageId}"]`);
    const durationSpan = document.querySelector(`.audio-duration[data-message-id="${messageId}"]`);
    
    if (progressFill) {
        const percent = (audio.currentTime / audio.duration) * 100 || 0;
        progressFill.style.width = percent + '%';
    }
    
    if (currentTimeSpan) {
        currentTimeSpan.textContent = formatTime(audio.currentTime);
    }
    
    if (durationSpan && audio.duration && !isNaN(audio.duration)) {
        durationSpan.textContent = formatTime(audio.duration);
    }
}

function seekAudio(messageId, event) {
    const audio = audioElements[messageId];
    if (!audio) return;
    
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = percent * audio.duration;
    updateAudioProgress(messageId);
}

// Вспомогательные функции
function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function disableSendButton() {
    sendBtnDisabled = true;
    document.getElementById('sendBtn').classList.add('disabled');
    setTimeout(() => {
        sendBtnDisabled = false;
        document.getElementById('sendBtn').classList.remove('disabled');
    }, MESSAGE_COOLDOWN);
}

// Экспорт в глобальную область
window.messages = messages;
window.unreadCounts = unreadCounts;
window.messageStatuses = messageStatuses;
window.deletedMessages = deletedMessages;
window.pendingMessages = pendingMessages;
window.messageQueue = messageQueue;

window.loadAllMessages = loadAllMessages;
window.loadChatHistory = loadChatHistory;
window.sendMessage = sendMessage;
window.sendAudioMessage = sendAudioMessage;
window.sendPendingMessages = sendPendingMessages;
window.processMessageQueue = processMessageQueue;
window.addToMessageQueue = addToMessageQueue;
window.deleteMessage = deleteMessage;
window.editMessage = editMessage;
window.saveEditedMessage = saveEditedMessage;
window.closeEditMessageModal = closeEditMessageModal;
window.renderMessages = renderMessages;
window.markMessagesAsRead = markMessagesAsRead;
window.updateUnreadCounts = updateUnreadCounts;
window.loadMessageStatuses = loadMessageStatuses;
window.saveMessageStatuses = saveMessageStatuses;
window.toggleRecording = toggleRecording;
window.toggleAudio = toggleAudio;
window.seekAudio = seekAudio;
