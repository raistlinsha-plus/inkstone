#import <CoreML/CoreML.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

static NSString *recognizeText(CGImageRef image, BOOL cpuOnly, NSError **error) {
  VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.recognitionLanguages = @[ @"zh-Hans", @"en-US" ];
  if (cpuOnly) {
    if (@available(macOS 14.0, *)) {
      NSDictionary *stages = [request supportedComputeStageDevicesAndReturnError:error];
      if (!stages)
        return nil;
      for (VNComputeStage stage in stages) {
        for (id<MLComputeDeviceProtocol> device in stages[stage]) {
          if ([device isKindOfClass:MLCPUComputeDevice.class]) {
            [request setComputeDevice:device forComputeStage:stage];
            break;
          }
        }
      }
    } else {
      request.usesCPUOnly = YES;
    }
  }
  VNImageRequestHandler *handler =
      [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  if (![handler performRequests:@[request] error:error])
    return nil;
  NSMutableArray *rows = [NSMutableArray new];
  for (VNRecognizedTextObservation *observation in request.results) {
    NSString *line = [observation topCandidates:1].firstObject.string;
    if (line.length)
      [rows addObject:line];
  }
  return [rows componentsJoinedByString:@"\n"];
}

// The preview and OCR share the same oriented pixel coordinates.
char *inkstone_decode(const char *source, const char *preview, int recognize) {
  @autoreleasepool {
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:source]];
    CGImageSourceRef input =
        CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
    if (!input)
      return NULL;
    size_t index = CGImageSourceGetPrimaryImageIndex(input);
    NSDictionary *opts = @{
      (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
      (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
      (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize : @3200
    };
    CGImageRef img = CGImageSourceCreateThumbnailAtIndex(
        input, index, (__bridge CFDictionaryRef)opts);
    CFRelease(input);
    if (!img)
      return NULL;
    NSURL *out =
        [NSURL fileURLWithPath:[NSString stringWithUTF8String:preview]];
    CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
        (__bridge CFURLRef)out, CFSTR("public.jpeg"), 1, NULL);
    if (!dest) {
      CGImageRelease(img);
      return NULL;
    }
    CGImageDestinationAddImage(
        dest, img, (__bridge CFDictionaryRef) @{
          (__bridge NSString *)
          kCGImageDestinationLossyCompressionQuality : @0.86
        });
    BOOL ok = CGImageDestinationFinalize(dest);
    CFRelease(dest);
    if (!ok) {
      CGImageRelease(img);
      return NULL;
    }
    if (!recognize) {
      CGImageRelease(img);
      return strdup("");
    }
    NSError *error = nil;
    NSString *text = recognizeText(img, NO, &error);
    if (!text) {
      // An accelerator can fail to prepare the text model, especially at cold
      // start. Retry with a fresh request and handler on the CPU.
      NSLog(@"Inkstone OCR retry on CPU (%@ %ld)", error.domain, (long)error.code);
      error = nil;
      text = recognizeText(img, YES, &error);
      if (!text) {
        NSLog(@"Inkstone OCR failed (%@ %ld)", error.domain, (long)error.code);
        text = @"（本机文字识别未完成）";
      }
    }
    CGImageRelease(img);
    return strdup(text.UTF8String ?: "");
  }
}
void inkstone_free(char *p) { free(p); }
