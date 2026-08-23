export interface StorageAdapter {
  /** Записывает поток в хранилище под сгенерированным ключом, возвращает ключ и размер. */
  put(input: {
    stream: NodeJS.ReadableStream;
    suggestedName: string;
    schoolId: string;
  }): Promise<{ storageKey: string; sizeBytes: number }>;

  /** Отдаёт поток чтения по ключу. Кидает ошибку, если файла нет. */
  get(storageKey: string): Promise<NodeJS.ReadableStream>;

  /** Удаляет файл. Не кидает ошибку, если файла уже нет. */
  remove(storageKey: string): Promise<void>;
}
