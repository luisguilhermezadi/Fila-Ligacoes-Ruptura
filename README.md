# CallUp Cons — GitHub + Supabase

Projeto preparado para publicação gratuita com frontend estático + Supabase.

## Arquitetura

- GitHub Pages/Cloudflare Pages: frontend.
- Supabase: autenticação, PostgreSQL, RLS e controle de sessão.
- Contatos da planilha continuam no dispositivo (`localStorage`).
- A planilha deve ter coluna 1 = nome e coluna 2 = número.

## Configuração

1. Crie um projeto gratuito no Supabase.
2. Abra o SQL Editor e execute `supabase/schema.sql`.
3. Crie uma conta com o e-mail `beawarumbyof@gmail.com`.
4. No SQL Editor, promova o administrador:

```sql
update public.profiles
set is_admin=true, status='approved'
where lower(email)='beawarumbyof@gmail.com';
```

5. Em `js/config.js`, coloque a URL e a chave anon/publishable do Supabase.
6. Publique a pasta no GitHub.
7. Ative GitHub Pages para a branch principal.
8. Abra `admin.html` com a conta administradora para gerenciar usuários.

## Importante

Não coloque `service_role` key no GitHub. Ela é secreta e não pode ficar no navegador.

## E-mail de aprovação

O cadastro fica `pending`. Para envio automático de e-mail administrativo, configure posteriormente um provedor de e-mail/Edge Function. O fluxo de aprovação já está separado do frontend.

## Sessão única

A RPC `claim_login_session()` impede uma segunda sessão enquanto a anterior estiver ativa. A sessão expira para fins de bloqueio de login após 30 minutos sem atualização; para produção, recomenda-se adicionar heartbeat/refresh periódico.

## Licença

Uso privado/projeto próprio.
