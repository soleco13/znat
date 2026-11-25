# Индексация: что сделать владельцу и как проверять

Добавление в sitemap не гарантирует индексацию — смотреть только данные Вебмастера и Search Console.

## 1. Яндекс Вебмастер (нужен вход владельца)

1. webmaster.yandex.ru → «Добавить сайт» → `https://matis-edu.ru`.
2. Подтверждение — DNS-записью TXT (не трогает сайт) или метатегом: пришлите код, добавлю в сборку.
3. «Индексирование → Файлы Sitemap» → `https://matis-edu.ru/sitemap.xml`.
4. «Инструменты → Анализ robots.txt»: адреса `/`, `/pricing`, `/contacts` — разрешены; `/api/v1/x` — запрещён.
5. «Инструменты → Проверка ответа сервера» для трёх страниц: 200 и текст страницы в ответе.
6. «Переобход страниц» — три адреса.
7. «Информация о сайте → Регион»: Россия. «Отображение в поиске → Название»: решить, «Матис» или «Matís».

## 2. Google Search Console

1. search.google.com/search-console → «Доменный ресурс» `matis-edu.ru` → TXT-запись в DNS.
2. «Файлы Sitemap» → `sitemap.xml`.
3. «Проверка URL» для трёх страниц → «Проверить страницу на сайте» → в «Просмотреть проверенную страницу» есть текст → «Запросить индексирование».

## 3. Приоритетные адреса для первой проверки

| Адрес | Ожидание |
|---|---|
| https://matis-edu.ru/ | 200, индекс, текст в HTML, JSON-LD Organization/WebSite |
| https://matis-edu.ru/pricing | 200, индекс, JSON-LD SoftwareApplication |
| https://matis-edu.ru/contacts | 200, индекс |
| https://matis-edu.ru/login | 200, noindex |
| https://matis-edu.ru/nonexistent | 200, noindex |
| https://www.matis-edu.ru/ | 301 на без www |

## 4. Проверки после каждой выкатки сайта

```bash
for p in / /pricing /contacts; do curl -s https://matis-edu.ru$p | grep -o '<h1[^>]*>[^<]*' ; done
curl -s https://matis-edu.ru/login | grep -o 'name="robots"[^>]*'
curl -s https://matis-edu.ru/robots.txt
```

Разметку — validator.schema.org и search.google.com/test/rich-results по адресам главной и «Тарифов».

## 5. Контроль раз в неделю

Вебмастер: «Страницы в поиске», «Исключённые страницы» (не должно быть адресов приложения), «Диагностика». Search Console: «Индексирование страниц», «Эффективность».
