// Ably клиент
let ably = null;
let ablyReconnectTimer = null;
let heartbeatInterval = null;
let presenceUpdateInterval = null;
let statusUpdateInterval = null;

// Состояние онлайн пользователей
let onlineUsers = {};

// Инициализация Ably
function initAbly() {
    if (!currentUser) return;
    
    if (ably) {
        try {
            ably.close();
        } catch (e) {}
    }
    
    ably = new Ably.Realtime({
        key: "pYHevw.VrFP9Q:8u3IGeMI56PtA4S6Z_VCVvvXpEXEmiIlfoAjfPb6BZg",
        clientId: currentUser.id.toString(),
        transports: ['web_socket'],
        disconnectedRetryTimeout: 1000,
        suspendedRetryTimeout: 2000,
        realtimeRequestTimeout: 15000,
        echoMessages: false,
        idleTimeout: 20000
    });

    ably.connection.on('connected', () => {
        console.log('Connected to Ably');
        
        if (ablyReconnectTimer) {
            clearTimeout(ablyReconnectTimer);
            ablyReconnectTimer = null;
        }
        
        const presenceChannel = ably.channels.get('presence');
        presenceChannel.presence.enter({ 
            name: currentUser.name, 
            avatar: currentUser.avatar || '👤',
            bio: currentUser.bio || '',
            isAdmin: currentUser.isAdmin || false,
            dnd: currentUser.dnd || false,
            lastSeen: Date.now()
        });
        
        setupPresenceHandlers(presenceChannel);
        
        // Подписываемся на персональный канал для звонков ВСЕГДА
        const userChannel = ably.channels.get(`user-${currentUser.id}`);
        setupUserChannelHandlers(userChannel);
        
        // Подписываемся на все чаты (и публичные, и приватные)
        subscribeToAllChats();
        
        // Глобальный канал для новых публичных чатов
        const globalChatsChannel = ably.channels.get('global-chats');
        globalChatsChannel.subscribe('new-chat', (message) => {
            const newChat = message.data;
            if (!publicChats?.find(c => c.id === newChat.id)) {
                publicChats?.push(newChat);
                if (currentTab === 'public' && typeof window.updateChatsList === 'function') {
                    window.updateChatsList();
                }
            }
        });
    });

    ably.connection.on('disconnected', () => {
        console.log('Ably disconnected, attempting to reconnect...');
        scheduleReconnect();
    });

    ably.connection.on('failed', () => {
        console.log('Ably failed, reinitializing...');
        scheduleReconnect(true);
    });
}

// Настройка обработчиков presence
function setupPresenceHandlers(presenceChannel) {
    presenceChannel.presence.subscribe('enter', (member) => {
        if (member.clientId !== currentUser.id.toString()) {
            onlineUsers[member.clientId] = {
                id: member.clientId,
                name: member.data.name,
                avatar: member.data.avatar || '👤',
                bio: member.data.bio || '',
                online: true,
                isAdmin: member.data.isAdmin || false,
                dnd: member.data.dnd || false,
                lastSeen: Date.now()
            };
            
            if (typeof window.sendQueuedMessagesToUser === 'function') {
                window.sendQueuedMessagesToUser(member.clientId);
            }
            
            if (currentTab === 'users' || currentTab === 'chats') {
                if (typeof window.updateChatsList === 'function') window.updateChatsList();
            }
            if (typeof window.updateChatStatus === 'function') window.updateChatStatus();
        }
    });
    
    presenceChannel.presence.subscribe('update', (member) => {
        if (member.clientId !== currentUser.id.toString()) {
            onlineUsers[member.clientId] = {
                ...onlineUsers[member.clientId],
                name: member.data.name,
                avatar: member.data.avatar,
                bio: member.data.bio,
                isAdmin: member.data.isAdmin,
                online: true,
                dnd: member.data.dnd,
                lastSeen: Date.now()
            };
            if (currentTab === 'users' || currentTab === 'chats') {
                if (typeof window.updateChatsList === 'function') window.updateChatsList();
            }
            if (typeof window.updateChatStatus === 'function') window.updateChatStatus();
        }
    });
    
    presenceChannel.presence.subscribe('leave', (member) => {
        if (onlineUsers[member.clientId]) {
            onlineUsers[member.clientId].online = false;
            onlineUsers[member.clientId].lastSeen = Date.now();
            if (currentTab === 'users' || currentTab === 'chats') {
                if (typeof window.updateChatsList === 'function') window.updateChatsList();
            }
            if (typeof window.updateChatStatus === 'function') window.updateChatStatus();
        }
    });
    
    presenceChannel.presence.get((err, members) => {
        if (members) {
            members.forEach(member => {
                if (member.clientId !== currentUser.id.toString()) {
                    onlineUsers[member.clientId] = {
                        id: member.clientId,
                        name: member.data.name,
                        avatar: member.data.avatar || '👤',
                        bio: member.data.bio || '',
                        online: true,
                        isAdmin: member.data.isAdmin || false,
                        dnd: member.data.dnd || false,
                        lastSeen: Date.now()
                    };
                }
            });
        }
        if (currentTab === 'users' || currentTab === 'chats') {
            if (typeof window.updateChatsList === 'function') window.updateChatsList();
        }
    });
}

// Настройка канала пользователя для звонков
function setupUserChannelHandlers(userChannel) {
    userChannel.subscribe('offer', async (message) => {
        const { offer, callerId, callerName, callerAvatar, callId, dbCallId, timestamp } = message.data;
        
        // Проверяем, не устарел ли звонок
        if (Date.now() - timestamp > 10000) {
            console.log('Ignoring old call offer', timestamp);
            return;
        }
        
        // Если уже есть активный звонок, отклоняем
        if (window.currentCall) {
            userChannel.publish('end', { callId, timestamp: Date.now() });
            return;
        }
        
        // Передаём данные в модуль звонков
        if (typeof window.handleIncomingCall === 'function') {
            window.handleIncomingCall({
                offer, callerId, callerName, callerAvatar, callId, dbCallId, timestamp
            });
        }
    });

    userChannel.subscribe('answer', async (message) => {
        const { answer, callId, timestamp } = message.data;
        if (Date.now() - timestamp > 10000) return;
        
        if (typeof window.handleCallAnswer === 'function') {
            window.handleCallAnswer({ answer, callId });
        }
    });

    userChannel.subscribe('ice-candidate', (message) => {
        const { candidate, callId, timestamp } = message.data;
        if (Date.now() - timestamp > 10000) return;
        
        if (typeof window.handleIceCandidate === 'function') {
            window.handleIceCandidate({ candidate, callId });
        }
    });

    userChannel.subscribe('end', (message) => {
        const { callId } = message.data;
        if (typeof window.handleCallEnd === 'function') {
            window.handleCallEnd({ callId });
        }
    });
}

// Подписка на все чаты
function subscribeToAllChats() {
    if (!myChats) return;
    
    myChats.forEach(chat => {
        // Подписываемся на ВСЕ чаты, кроме Избранного
        if (!chat.isFavorite) {
            subscribeToChatChannel(chat.id, chat.is_public);
        }
    });
}

// Подписка на канал чата
function subscribeToChatChannel(chatId, isPublic = false) {
    if (!ably || !currentUser) return;
    
    const chatChannel = ably.channels.get(`chat-${chatId}`);
    
    // Отписываемся от старых подписок
    chatChannel.unsubscribe();
    
    // Прикрепляемся с повторными попытками
    attachWithRetry(chatChannel, chatId);
    
    // Подписываемся на сообщения (работает для всех типов чатов)
    chatChannel.subscribe('message', (message) => {
        handleIncomingMessage(message, chatId);
    });
    
    // Для приватных чатов подписываемся на дополнительные события
    if (!isPublic) {
        chatChannel.subscribe('delivery_receipt', (data) => {
            handleDeliveryReceipt(data, chatId);
        });
        
        chatChannel.subscribe('read_receipt', (data) => {
            handleReadReceipt(data, chatId);
        });
        
        chatChannel.subscribe('delete', (data) => {
            handleDeleteMessage(data, chatId);
        });
        
        chatChannel.subscribe('edit', (data) => {
            handleEditMessage(data, chatId);
        });
    }
}

// Обработка входящего сообщения
function handleIncomingMessage(message, chatId) {
    const msg = message.data;
    if (!msg) return;
    
    // Игнорируем свои сообщения
    if (msg.sender_id === currentUser.id) return;
    
    // Проверяем timestamp
    const now = Date.now();
    const msgTime = msg.created_at ? new Date(msg.created_at).getTime() : now;
    if (now - msgTime > 60000) {
        console.log('Ignoring old message', msg);
        return;
    }
    
    // Проверяем, не удалено ли сообщение
    if (window.deletedMessages?.[chatId]?.includes(msg.id)) return;
    
    // Инициализируем messages если нужно
    if (!window.messages) window.messages = {};
    if (!window.messages[chatId]) window.messages[chatId] = [];
    
    // Проверяем дубликат
    const exists = window.messages[chatId].some(m => m.id === msg.id);
    if (!exists) {
        // Находим отправителя
        const sender = window.allUsers?.find(u => u.id === msg.sender_id) || 
                     { username: msg.sender_name || 'Неизвестно', avatar: '👤' };
        
        // Создаём сообщение
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
        
        // Добавляем в список
        window.messages[chatId].push(newMsg);
        if (Array.isArray(window.messages[chatId])) {
            window.messages[chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        
        // Отправляем подтверждение доставки для приватных чатов
        if (!window.publicChats?.find(c => c.id === chatId)) {
            chatChannel.publish('delivery_receipt', { 
                messageId: msg.id, 
                receiver: currentUser.id
            });
        }
        
        // Обновляем счетчик непрочитанных
        if (!window.unreadCounts) window.unreadCounts = {};
        if (currentChat?.id !== chatId) {
            window.unreadCounts[chatId] = (window.unreadCounts[chatId] || 0) + 1;
            
            // Показываем уведомление
            if (Notification.permission === 'granted') {
                new Notification(`Новое сообщение от ${sender.username}`, {
                    body: msg.text || 'Голосовое сообщение',
                    icon: sender.avatar
                });
            }
        }
        
        // Если это текущий чат, обновляем UI
        if (currentChat && currentChat.id === chatId) {
            if (typeof window.renderMessages === 'function') window.renderMessages();
            window.unreadCounts[chatId] = 0;
            if (typeof window.markMessagesAsRead === 'function') window.markMessagesAsRead(chatId);
        }
        
        // ВСЕГДА обновляем список чатов (чтобы последнее сообщение появилось)
        if (typeof window.updateChatsList === 'function') window.updateChatsList();
    }
}

// Обработка подтверждения доставки
function handleDeliveryReceipt(data, chatId) {
    const { messageId } = data.data;
    if (window.messageStatuses?.[messageId]) {
        window.messageStatuses[messageId].status = 'delivered';
        if (typeof window.saveMessageStatuses === 'function') window.saveMessageStatuses();
    }
    if (currentChat && currentChat.id === chatId) {
        if (typeof window.renderMessages === 'function') window.renderMessages();
    }
}

// Обработка подтверждения прочтения
function handleReadReceipt(data, chatId) {
    const { messageId } = data.data;
    if (window.messageStatuses?.[messageId]) {
        window.messageStatuses[messageId].status = 'read';
        if (typeof window.saveMessageStatuses === 'function') window.saveMessageStatuses();
    }
    if (currentChat && currentChat.id === chatId) {
        if (typeof window.renderMessages === 'function') window.renderMessages();
    }
}

// Обработка удаления сообщения
function handleDeleteMessage(data, chatId) {
    const { messageId } = data.data;
    
    if (!window.deletedMessages) window.deletedMessages = {};
    if (!window.deletedMessages[chatId]) window.deletedMessages[chatId] = [];
    if (!window.deletedMessages[chatId].includes(messageId)) {
        window.deletedMessages[chatId].push(messageId);
        localStorage.setItem('deletedMessages', JSON.stringify(window.deletedMessages));
    }
    if (window.messages?.[chatId]) {
        window.messages[chatId] = window.messages[chatId].filter(m => m.id !== messageId);
        if (currentChat?.id === chatId && typeof window.renderMessages === 'function') {
            window.renderMessages();
        }
        if (typeof window.updateChatsList === 'function') window.updateChatsList();
    }
}

// Обработка редактирования сообщения
function handleEditMessage(data, chatId) {
    const { messageId, newText } = data.data;
    
    if (window.messages?.[chatId]) {
        const msgIndex = window.messages[chatId].findIndex(m => m.id === messageId);
        if (msgIndex !== -1) {
            window.messages[chatId][msgIndex].text = newText;
            window.messages[chatId][msgIndex].edited = true;
            if (currentChat?.id === chatId && typeof window.renderMessages === 'function') {
                window.renderMessages();
            }
        }
    }
}

// Вспомогательные функции
function attachWithRetry(channel, chatId, retries = 10, delay = 300) {
    channel.attach((err) => {
        if (err) {
            console.error(`Failed to attach to chat channel ${chatId}, retries left: ${retries}`, err);
            if (retries > 0) {
                setTimeout(() => attachWithRetry(channel, chatId, retries - 1, delay), delay);
            }
        } else {
            console.log(`Attached to chat-${chatId}`);
        }
    });
}

function scheduleReconnect(fullReinit = false) {
    if (ablyReconnectTimer) clearTimeout(ablyReconnectTimer);
    ablyReconnectTimer = setTimeout(() => {
        if (currentUser) {
            if (fullReinit) {
                initAbly();
            } else if (ably && ably.connection.state !== 'connected') {
                ably.connection.connect();
            }
        }
    }, fullReinit ? 3000 : 1000);
}

// Heartbeat для поддержания присутствия
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (ably && ably.connection.state === 'connected' && currentUser) {
            const presenceChannel = ably.channels.get('presence');
            if (presenceChannel.state === 'attached') {
                presenceChannel.presence.update({ 
                    name: currentUser.name,
                    avatar: currentUser.avatar || '👤',
                    bio: currentUser.bio || '',
                    isAdmin: currentUser.isAdmin || false,
                    dnd: currentUser.dnd || false,
                    lastSeen: Date.now()
                });
            }
        }
    }, 20000);
}

function startPresenceUpdates() {
    if (presenceUpdateInterval) clearInterval(presenceUpdateInterval);
    presenceUpdateInterval = setInterval(() => {
        if (ably && ably.connection.state === 'connected' && currentUser) {
            const presenceChannel = ably.channels.get('presence');
            if (presenceChannel.state === 'attached') {
                presenceChannel.presence.update({ 
                    name: currentUser.name,
                    avatar: currentUser.avatar || '👤',
                    bio: currentUser.bio || '',
                    isAdmin: currentUser.isAdmin || false,
                    dnd: currentUser.dnd || false,
                    lastSeen: Date.now()
                });
            }
        }
    }, 20000);
}

function startStatusUpdates() {
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
    statusUpdateInterval = setInterval(() => {
        if (currentTab === 'users' || currentTab === 'chats') {
            if (typeof window.updateChatsList === 'function') window.updateChatsList();
        }
        if (typeof window.updateChatStatus === 'function') window.updateChatStatus();
    }, 2000);
}

// Экспорт в глобальную область
window.ably = ably;
window.onlineUsers = onlineUsers;

window.initAbly = initAbly;
window.subscribeToChatChannel = subscribeToChatChannel;
window.startHeartbeat = startHeartbeat;
window.startPresenceUpdates = startPresenceUpdates;
window.startStatusUpdates = startStatusUpdates;
