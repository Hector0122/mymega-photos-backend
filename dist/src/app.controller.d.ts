import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getPhotos(pageToken?: string, maxKeys?: string): Promise<{
        photos: {
            uri: string;
            date: string;
        }[];
        nextToken: string | null;
    }>;
    getPhotoByFilename(filename: string): Promise<{
        url: string;
    }>;
    uploadPhoto(file: Express.Multer.File): Promise<{
        url: string;
    }>;
    deletePhoto(filename: string): Promise<{
        deleted: boolean;
    }>;
    migrateThumbnails(): Promise<{
        generated: number;
    }>;
    migrateFolders(): Promise<{
        moved: number;
    }>;
}
