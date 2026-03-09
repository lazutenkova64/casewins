// ========== SUPABASE КОНФИГУРАЦИЯ ==========
const SUPABASE_URL = "https://olqwgfesedzrnpwfwqpa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nuCZ7nbXGaseOjl8VIsKpA_-o1MEZlY";
const ADMIN_USERNAME = "K1lame";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: true, 
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// ========== ПРОВЕРКА СУЩЕСТВОВАНИЯ ТАБЛИЦЫ calls ==========
async function checkCallsTable() {
    try {
        const { error } = await supabaseClient
            .from('calls')
            .select('id')
            .limit(1);
        if (error && error.code === 'PGRST116') {
            window.callsTableExists = false;
            console.warn('Таблица "calls" не найдена. Функция звонков будет недоступна.');
        } else {
            window.callsTableExists = true;
        }
    } catch (err) {
        window.callsTableExists = false;
        console.warn('Не удалось проверить таблицу calls, звонки отключены.', err);
    }
}

// ========== ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ ==========
async function loadAllUsers() {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('username');
        
        if (error) throw error;
        
        window.allUsers = data || [];
        
        if (window.currentTab === 'users') {
            updateChatsList();
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
}
