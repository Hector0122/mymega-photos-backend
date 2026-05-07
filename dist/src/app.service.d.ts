export declare class AppService {
    private s3;
    getPhotos(): Promise<string[]>;
    uploadPhotoBase64(base64Image: string, filename: string): Promise<string>;
    getPhotoByFilename(): Promise<void>;
}
