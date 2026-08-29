export interface StorageAdapter {
  /** Записывает поток в хранилище под сгенерированным ключом, возвращает ключ и размер. */
  put(input: {
    stream: NodeJS.ReadableStream;
    suggestedName: string;
    schoolId: string;
  }): Promise<{ storageKey: string; sizeBytes: number }>;

  /** Отдаёт поток чтения по ключу. Кидает ошибку, если файла нет. */
  get(storageKey: string): Promise<NodeJS.ReadableStream>;

  /**
   * Копирует существующий файл под новым ключом в каталоге школы. Для дедупа
   * презентаций (Э4.5): та же презентация не конвертируется дважды, но каждый
   * `deck` владеет собственными файлами — удаление одной презентации не трогает
   * файлы другой, `deleteDeck` остаётся без учёта ссылок.
   */
  copy(input: { sourceKey: string; schoolId: string }): Promise<{ storageKey: string; sizeBytes: number }>;

  /** Удаляет файл. Не кидает ошибку, если файла уже нет. */
  remove(storageKey: string): Promise<void>;
}
