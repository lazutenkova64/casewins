// Supabase конфигурация
const SUPABASE_URL = "https://olqwgfesedzrnpwfwqpa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nuCZ7nbXGaseOjl8VIsKpA_-o1MEZlY";
const ADMIN_USERNAME = "K1lame";

// Инициализация Supabase клиента
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: true, 
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// Глобальные переменные для доступа из других модулей
window.supabaseClient = supabaseClient;
window.ADMIN_USERNAME = ADMIN_USERNAME;
