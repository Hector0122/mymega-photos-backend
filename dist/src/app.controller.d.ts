import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getPhotos(user: {
        id: string;
    }, pageToken?: string, maxKeys?: string, query?: string, favorites?: string, blurry?: string): Promise<{
        photos: {
            uri: string;
            date: string;
            id: string;
            favorite: boolean;
            tags: string[];
            blurred: boolean;
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
        id: string;
        url: string;
        filename: string;
        lat: number | null;
        lng: number | null;
    }[]>;
    getPhotoStats(user: {
        id: string;
    }): Promise<{
        photoCount: number;
        albumCount: number;
        favoriteCount: number;
        blurryCount: number;
    }>;
    getThisDayPhotos(user: {
        id: string;
    }): Promise<{
        year: number;
        uri: string;
        id: string;
        filename: string;
        count: number;
        yearsAgo: number;
    }[]>;
    analyzeAllPhotos(user: {
        id: string;
    }): Promise<{
        analyzed: number;
    }>;
    getDuplicates(user: {
        id: string;
    }): Promise<{
        id: string;
        url: string;
        filename: string;
        perceptualHash: string | null;
        blurred: boolean;
        blurScore: number | null;
        createdAt: Date;
    }[][]>;
    analyzePhoto(_user: {
        id: string;
    }, id: string): Promise<{
        blurred: boolean;
        blurScore: number;
        perceptualHash: string;
    }>;
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
    exportPhotos(user: {
        id: string;
    }): Promise<{
        message: string;
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
