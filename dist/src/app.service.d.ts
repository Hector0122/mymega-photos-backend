export declare class AppService {
    private s3;
    private baseName;
    getPhotos(continuationToken?: string, maxKeys?: number): Promise<{
        photos: {
            uri: string;
            date: string;
        }[];
        nextToken: string | null;
    }>;
    uploadPhoto(buffer: Buffer, filename: string): Promise<string>;
    getPhotoUrl(key: string): Promise<string>;
    deletePhoto(key: string): Promise<void>;
    generateMissingThumbnails(): Promise<{
        generated: number;
    }>;
    migrateToFolders(): Promise<{
        moved: number;
    }>;
}
