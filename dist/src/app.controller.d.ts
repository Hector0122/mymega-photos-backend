import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getPhotos(user: {
        id: string;
    }, pageToken?: string, maxKeys?: string, query?: string, favorites?: string): Promise<{
        photos: {
            uri: string;
            date: string;
            id: string;
            favorite: boolean;
            tags: string[];
        }[];
        nextToken: string | null;
    }>;
    toggleFavorite(user: {
        id: string;
    }, id: string): Promise<{
        favorite: boolean;
    }>;
    addTag(user: {
        id: string;
    }, id: string, tag: string): Promise<{
        tags: string[];
    }>;
    removeTag(user: {
        id: string;
    }, id: string, tag: string): Promise<{
        tags: string[];
    }>;
    getGeotaggedPhotos(user: {
        id: string;
    }): Promise<{
        url: string;
        id: string;
        s3Key: string;
        filename: string;
        lat: number | null;
        lng: number | null;
    }[]>;
    getPhotoById(user: {
        id: string;
    }, id: string): Promise<{
        url: string;
    }>;
    uploadPhoto(user: {
        id: string;
    }, file: Express.Multer.File, lat?: string, lng?: string): Promise<{
        url: string;
    }>;
    getShareLink(user: {
        id: string;
    }, id: string, expiresIn?: string): Promise<{
        url: string;
    }>;
    deletePhoto(user: {
        id: string;
    }, id: string): Promise<{
        deleted: boolean;
    }>;
    migrateThumbnails(): Promise<{
        generated: number;
    }>;
    migrateFolders(): Promise<{
        moved: number;
    }>;
    syncS3(): Promise<{
        synced: number;
    }>;
}
