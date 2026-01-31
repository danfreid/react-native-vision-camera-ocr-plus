#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DocumentRecognizerWithLLM, NSObject)

RCT_EXTERN_METHOD(initialize:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(processTableWithLLM:(NSString *)leftUri
                  rightUri:(NSString *)rightUri
                  contextPrompt:(NSString *)contextPrompt
                  withResolver:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
