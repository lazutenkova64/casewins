// ========== СООБЩЕНИЯ ==========
let messages = {};
let messageStatuses = {};
let deletedMessages = {};
let pendingMessages = {};
let messageQueue = {};
let lastMessageTime = 0;
const MESSAGE_COOLDOWN = 500;
let sendBtnDisabled = false;

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

async function loadAllMessages() {
    if (!window.currentUser) return;
    
    try {
        const lastSync = localStorage.getItem(`lastSync_${window.currentUser.id}`);
        const lastSyncTime = lastSync ? new Date(parseInt(lastSync)).toISOString() : new Date(0).toISOString();
        
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .gt('created_at', lastSyncTime)
            .order('created_at', { ascending: true })
            .limit(500);
        
        if (error) {
            console.error('Error loading messages:', error);
            return;
        }
        
        if (data && data.length > 0) {
            data.forEach(msg => {
                const chatId = msg.chat_id;
                
                if (deletedMessages[chatId] && deletedMessages[chatId].includes(msg.id)) {
                    return;
                }
                
                if (!messages[chatId]) messages[chatId] = [];
                
                const exists = messages[chatId].some(m => m.id === msg.id);
                if (!exists) {
                    const sender = window.allUsers.find(u => u.id === msg.sender_id) || { username: 'Неизвестно', avatar: '👤' };
                    
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
                        type: msg.sender_id === window.currentUser.id ? 'out' : 'in'
                    });
                    
                    if (msg.sender_id === window.currentUser.id && !messageStatuses[msg.id]) {
                        messageStatuses[msg.id] = {
                            status: 'sent',
                            deliveredAt: null,
                            readAt: null
                        };
                    }
                }
            });
            
            localStorage.setItem(`lastSync_${window.currentUser.id}`, Date.now().toString());
        }
        
        Object.keys(messages).forEach(chatId => {
            messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        });
        
        updateUnreadCounts();
        
    } catch (err) {
        console.error('Error loading all messages:', err);
    }
}

async function loadChatHistory(chatId) {
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: true })
            .limit(200);
        
        if (error) {
            console.error('Ошибка загрузки истории:', error);
            return;
        }
        
        if (data && data.length > 0) {
            if (!messages[chatId]) messages[chatId] = [];
            
            data.forEach(msg => {
                if (deletedMessages[chatId] && deletedMessages[chatId].includes(msg.id)) {
                    return;
                }
                
                const existingMsg = messages[chatId].find(m => m.id === msg.id);
                if (!existingMsg) {
                    const sender = window.allUsers.find(u => u.id === msg.sender_id) || { username: 'Неизвестно', avatar: '👤' };
                    
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
                        type: msg.sender_id === window.currentUser.id ? 'out' : 'in'
                    });
                    
                    if (msg.sender_id === window.currentUser.id && !messageStatuses[msg.id]) {
                        messageStatuses[msg.id] = {
                            status: 'sent',
                            deliveredAt: null,
                            readAt: null
                        };
                    }
                }
            });
            
            messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            if (currentChat && currentChat.id === chatId) {
                renderMessages();
            }
        }
    } catch (err) {
        console.error('Ошибка при загрузке истории:', err);
    }
}

async function sendMessage() {
    if (sendBtnDisabled) {
        alert('Слишком часто! Подождите секунду.');
        return;
    }

    console.log('Отправка сообщения:', text);
    
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
    const clientId = generateUUID();
    
    const localMessage = {
        id: clientId,
        chatId: currentChat.id,
        sender: window.currentUser.id,
        senderName: window.currentUser.name,
        text: text,
        time: timeString,
        timestamp: timestamp,
        isAdmin: window.currentUser.isAdmin,
        edited: false,
        type: 'out'
    };
    
    if (!messages[currentChat.id]) messages[currentChat.id] = [];
    messages[currentChat.id].push(localMessage);
    messages[currentChat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    messageStatuses[clientId] = { status: 'sent', sentAt: timestamp };
    saveMessageStatuses();
    
    input.value = '';
    input.style.height = 'auto';
    
    renderMessages();
    updateChatsList();
    forceShowInput();
    
    const dbMessage = {
        chat_id: currentChat.id,
        sender_id: window.currentUser.id,
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
            if (!pendingMessages[window.currentUser.id]) pendingMessages[window.currentUser.id] = [];
            pendingMessages[window.currentUser.id].push({ ...dbMessage, tempId: clientId });
            localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
            
            if (error.code === '42501') {
                alert('Ошибка прав доступа к таблице messages. Убедитесь, что в Supabase настроены политики RLS.');
            }
        } else {
            const realId = data[0].id;
            const msgIndex = messages[currentChat.id].findIndex(m => m.id === clientId);
            if (msgIndex !== -1) {
                messages[currentChat.id][msgIndex].id = realId;
            }
            messageStatuses[realId] = messageStatuses[clientId];
            delete messageStatuses[clientId];
            saveMessageStatuses();
            
            if (ably && !currentChat.is_public && currentChat.pair_key !== `${window.currentUser.id}_${window.currentUser.id}`) {
                const chatChannel = ably.channels.get(`chat-${currentChat.id}`);
                console.log('Отправлено:', { ...dbMessage, id: realId, sender_name: window.currentUser.name });
                chatChannel.publish('message', { 
                    ...dbMessage, 
                    id: realId, 
                    sender_name: window.currentUser.name 
                }, (err) => {
                    if (err) {
                        console.error('Failed to publish message to Ably', err);
                        const otherUserId = currentChat.pair_key.split('_').find(id => id !== window.currentUser.id);
                        const otherUser = window.allUsers.find(u => u.id === otherUserId);
                        if (otherUser) {
                            addToMessageQueue(otherUser.id, { 
                                ...dbMessage, 
                                id: realId, 
                                sender_name: window.currentUser.name 
                            });
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Ошибка при сохранении:', err);
        if (!pendingMessages[window.currentUser.id]) pendingMessages[window.currentUser.id] = [];
        pendingMessages[window.currentUser.id].push({ ...dbMessage, tempId: clientId });
        localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
    }
}

async function sendAudioMessage(audioBlob, duration) {
    if (!currentChat) {
        alert('Сначала выберите чат');
        return;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const clientId = generateUUID();
    const timestamp = now.getTime();

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        const base64Audio = reader.result;

        const localMessage = {
            id: clientId,
            chatId: currentChat.id,
            sender: window.currentUser.id,
            senderName: window.currentUser.name,
            audio: base64Audio,
            duration: duration,
            time: timeString,
            timestamp: timestamp,
            isAdmin: window.currentUser.isAdmin,
            edited: false,
            type: 'out'
        };

        if (!messages[currentChat.id]) messages[currentChat.id] = [];
        messages[currentChat.id].push(localMessage);
        messages[currentChat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        messageStatuses[clientId] = { status: 'sent', sentAt: timestamp };
        saveMessageStatuses();
        
        renderMessages();
        updateChatsList();
        forceShowInput();

        const dbMessage = {
            chat_id: currentChat.id,
            sender_id: window.currentUser.id,
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
                if (!pendingMessages[window.currentUser.id]) pendingMessages[window.currentUser.id] = [];
                pendingMessages[window.currentUser.id].push({ ...dbMessage, tempId: clientId });
                localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
                
                if (error.code === '42501') {
                    alert('Ошибка прав доступа к таблице messages.');
                }
            } else {
                const realId = data[0].id;
                const msgIndex = messages[currentChat.id].findIndex(m => m.id === clientId);
                if (msgIndex !== -1) {
                    messages[currentChat.id][msgIndex].id = realId;
                }
                messageStatuses[realId] = messageStatuses[clientId];
                delete messageStatuses[clientId];
                saveMessageStatuses();
                
                if (ably && !currentChat.is_public && currentChat.pair_key !== `${window.currentUser.id}_${window.currentUser.id}`) {
                    const chatChannel = ably.channels.get(`chat-${currentChat.id}`);
                    chatChannel.publish('message', { 
                        ...dbMessage, 
                        id: realId, 
                        sender_name: window.currentUser.name 
                    }, (err) => {
                        if (err) {
                            console.error('Failed to publish audio message to Ably', err);
                            const otherUserId = currentChat.pair_key.split('_').find(id => id !== window.currentUser.id);
                            const otherUser = window.allUsers.find(u => u.id === otherUserId);
                            if (otherUser) {
                                addToMessageQueue(otherUser.id, { 
                                    ...dbMessage, 
                                    id: realId, 
                                    sender_name: window.currentUser.name 
                                });
                            }
                        }
                    });
                }
            }
        } catch (err) {
            console.error('Ошибка при сохранении аудио:', err);
            if (!pendingMessages[window.currentUser.id]) pendingMessages[window.currentUser.id] = [];
            pendingMessages[window.currentUser.id].push({ ...dbMessage, tempId: clientId });
            localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
        }
    };
}

function deleteMessage(messageId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentChat) return;
    
    const msg = messages[currentChat.id]?.find(m => m.id === messageId);
    if (!msg) return;
    
    if (!window.currentUser.isAdmin && msg.sender != window.currentUser.id) {
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
    
    if (ably && !currentChat.is_public && currentChat.pair_key !== `${window.currentUser.id}_${window.currentUser.id}`) {
        const chatChannel = ably.channels.get(`chat-${currentChat.id}`);
        chatChannel.publish('delete', { messageId, senderId: window.currentUser.id });
    }
    
    hideMessageActions();
    renderMessages();
    updateChatsList();
    forceShowInput();
}

function editMessage(messageId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentChat) return;
    
    const msg = messages[currentChat.id]?.find(m => m.id === messageId);
    if (!msg) return;
    
    if (msg.sender != window.currentUser.id) {
        alert('Вы можете редактировать только свои сообщения');
        return;
    }
    
    window.messageToEdit = msg;
    document.getElementById('editMessageText').value = msg.text || '';
    document.getElementById('editMessageModal').classList.add('active');
    hideMessageActions();
}

function saveEditedMessage() {
    const newText = document.getElementById('editMessageText').value.trim();
    if (!newText || !window.messageToEdit || !currentChat) return;
    
    const msgIndex = messages[currentChat.id].findIndex(m => m.id === window.messageToEdit.id);
    if (msgIndex !== -1) {
        messages[currentChat.id][msgIndex].text = newText;
        messages[currentChat.id][msgIndex].edited = true;
        
        supabaseClient
            .from('messages')
            .update({ text: newText, edited: true })
            .eq('id', window.messageToEdit.id)
            .then(({ error }) => {
                if (error) console.error('Error updating message in DB:', error);
            });
        
        if (ably && !currentChat.is_public && currentChat.pair_key !== `${window.currentUser.id}_${window.currentUser.id}`) {
            const chatChannel = ably.channels.get(`chat-${currentChat.id}`);
            chatChannel.publish('edit', { 
                messageId: window.messageToEdit.id, 
                newText, 
                editor: window.currentUser.id
            });
        }
        
        renderMessages();
        closeEditMessageModal();
    }
}

function markMessagesAsRead(chatId) {
    if (!ably || !messages[chatId] || !currentChat || currentChat.is_public) return;
    
    let changed = false;
    messages[chatId].forEach(msg => {
        if (msg.sender != window.currentUser.id && 
            (!messageStatuses[msg.id] || messageStatuses[msg.id].status !== 'read')) {
            
            if (!messageStatuses[msg.id]) {
                messageStatuses[msg.id] = { status: 'read', readAt: Date.now() };
            } else {
                messageStatuses[msg.id].status = 'read';
                messageStatuses[msg.id].readAt = Date.now();
            }
            changed = true;
            
            const chatChannel = ably.channels.get(`chat-${chatId}`);
            chatChannel.publish('read_receipt', { 
                messageId: msg.id, 
                reader: window.currentUser.id
            });
        }
    });
    
    if (changed) {
        saveMessageStatuses();
    }
}

function markAllMessagesAsRead(chatId) {
    if (!messages[chatId]) return;
    
    let changed = false;
    messages[chatId].forEach(msg => {
        if (msg.sender !== window.currentUser.id) {
            if (!messageStatuses[msg.id] || messageStatuses[msg.id].status !== 'read') {
                messageStatuses[msg.id] = { status: 'read', readAt: Date.now() };
                changed = true;
            }
        }
    });
    
    if (changed) {
        saveMessageStatuses();
    }
    
    unreadCounts[chatId] = 0;
    updateChatsList();
}

function updateUnreadCounts() {
    if (!window.currentUser) return;
    
    Object.keys(messages).forEach(chatId => {
        if (currentChat && chatId === currentChat.id) {
            unreadCounts[chatId] = 0;
        } else {
            let count = 0;
            messages[chatId]?.forEach(msg => {
                if (msg.sender !== window.currentUser.id && 
                    (!messageStatuses[msg.id] || messageStatuses[msg.id].status !== 'read')) {
                    count++;
                }
            });
            unreadCounts[chatId] = count;
        }
    });
    
    updateChatsList();
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
        if (ably) {
            const chatChannel = ably.channels.get(`chat-${message.chat_id}`);
            chatChannel.publish('message', message);
        }
    });
}

async function sendPendingMessages() {
    if (!window.currentUser || !pendingMessages[window.currentUser.id]) return;
    
    const pending = pendingMessages[window.currentUser.id];
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
                    const msgIndex = messages[chatId].findIndex(m => m.id === tempId);
                    if (msgIndex !== -1) {
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
    
    delete pendingMessages[window.currentUser.id];
    localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
}

function processMessageQueue() {
    if (!ably || !window.currentUser) return;
    
    Object.keys(messageQueue).forEach(userId => {
        const userOnline = onlineUsers[userId] && onlineUsers[userId].online;
        if (userOnline) {
            sendQueuedMessagesToUser(userId);
        }
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

function subscribeToChatChannel(chatId) {
    if (!ably || !window.currentUser) return;
    
    const chatChannel = ably.channels.get(`chat-${chatId}`);
    
    chatChannel.unsubscribe();
    
    function attachWithRetry(retries = 5, delay = 200) {
        chatChannel.attach((err) => {
            if (err) {
                console.error(`Failed to attach to chat channel ${chatId}, retries left: ${retries}`, err);
                if (retries > 0) {
                    setTimeout(() => attachWithRetry(retries - 1, delay), delay);
                }
                return;
            }
            console.log(`Attached to chat-${chatId}`);
        });
    }
    
    attachWithRetry(5, 200);

    chatChannel.subscribe('message', (message) => {
        console.log('Получено сообщение:', message.data);
        
        const msg = message.data;
        if (!msg) return;
        
        if (msg.sender_id === window.currentUser.id) return;
        
        const now = Date.now();
        const msgTime = msg.created_at ? new Date(msg.created_at).getTime() : now;
        if (now - msgTime > 60000) {
            console.log('Ignoring old message', msg);
            return;
        }
        
        if (deletedMessages[chatId] && deletedMessages[chatId].includes(msg.id)) return;
        
        if (!messages[chatId]) messages[chatId] = [];
        
        const exists = messages[chatId].some(m => m.id === msg.id);
        if (!exists) {
            const sender = window.allUsers.find(u => u.id === msg.sender_id) || { username: msg.sender_name || 'Неизвестно', avatar: '👤' };
            
            const newMsg = {
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
                type: 'in'
            };
            
            messages[chatId].push(newMsg);
            messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            chatChannel.publish('delivery_receipt', { 
                messageId: msg.id, 
                receiver: window.currentUser.id
            });
            
            if (currentChat?.id !== chatId) {
                unreadCounts[chatId] = (unreadCounts[chatId] || 0) + 1;
                
                if (Notification.permission === 'granted') {
                    new Notification(`Новое сообщение от ${sender.username}`, {
                        body: msg.text || 'Голосовое сообщение',
                        icon: sender.avatar
                    });
                }
            }
            
            if (currentChat && currentChat.id === chatId) {
                console.log('Получено:', msg);
                renderMessages();
                unreadCounts[chatId] = 0;
                markMessagesAsRead(chatId);
            }
            
            updateChatsList();
        }
    });
    
    chatChannel.subscribe('delivery_receipt', (data) => {
        const { messageId } = data.data;
        if (messageStatuses[messageId]) {
            messageStatuses[messageId].status = 'delivered';
            saveMessageStatuses();
        }
        if (currentChat && currentChat.id === chatId) {
            renderMessages();
        }
    });
    
    chatChannel.subscribe('read_receipt', (data) => {
        const { messageId } = data.data;
        if (messageStatuses[messageId]) {
            messageStatuses[messageId].status = 'read';
            saveMessageStatuses();
        }
        if (currentChat && currentChat.id === chatId) {
            renderMessages();
        }
    });
    
    chatChannel.subscribe('delete', (data) => {
        const { messageId } = data.data;
        
        if (!deletedMessages[chatId]) deletedMessages[chatId] = [];
        if (!deletedMessages[chatId].includes(messageId)) {
            deletedMessages[chatId].push(messageId);
            localStorage.setItem('deletedMessages', JSON.stringify(deletedMessages));
        }
        if (messages[chatId]) {
            messages[chatId] = messages[chatId].filter(m => m.id !== messageId);
            if (currentChat?.id === chatId) renderMessages();
            updateChatsList();
        }
    });
    
    chatChannel.subscribe('edit', (data) => {
        const { messageId, newText } = data.data;
        
        if (messages[chatId]) {
            const msgIndex = messages[chatId].findIndex(m => m.id === messageId);
            if (msgIndex !== -1) {
                messages[chatId][msgIndex].text = newText;
                messages[chatId][msgIndex].edited = true;
                if (currentChat?.id === chatId) renderMessages();
            }
        }
    });
}
