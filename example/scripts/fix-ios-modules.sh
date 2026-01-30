#!/bin/bash
# This script fixes iOS native modules for EAS Build

echo "Fixing iOS native modules..."

# The parent directory contains the library source
LIB_IOS="../ios"

# Fix RemoveLanguageModel.swift - remove private, add requiresMainQueueSetup
cat > "$LIB_IOS/RemoveLanguageModel.swift" << 'EOF'
import Foundation
import React
import MLKitTranslate

@objc(RemoveLanguageModel)
class RemoveLanguageModel: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
      return false
  }

  @objc(remove:withResolver:withRejecter:)
  func remove(_ code: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
      guard let modelName = TranslateLanguage(from: code) else {
          resolve(false)
          return
      }
      let model = TranslateRemoteModel.translateRemoteModel(language: modelName)
      ModelManager.modelManager().deleteDownloadedModel(model) { error in
          guard error == nil else {
              return
          }
          resolve(true)
      }
  }
}
EOF

# Fix PhotoRecognizerModule.swift
cat > "$LIB_IOS/PhotoRecognizerModule.swift" << 'EOF'
import Foundation
import UIKit
import React
import MLKitVision
import MLKitTextRecognition

@objc(PhotoRecognizerModule)
class PhotoRecognizerModule: NSObject {

    private static let options = TextRecognizerOptions()
    private let textRecognizer = TextRecognizer.textRecognizer(options:options)
    private var data: [String: Any] = [:]

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc(process:orientation:withResolver:withRejecter:)
    func process(_ uri: String, orientation: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
            let image =  UIImage(contentsOfFile: uri)
            if image != nil {
                do {
                    let visionImage = VisionImage(image: image!)
                    visionImage.orientation = getOrientation(orientation: orientation)
                    let result = try textRecognizer.results(in: visionImage)
                    let blocks = RNVisionCameraOCR.processBlocks(blocks: result.blocks)
                    data["resultText"] = result.text
                    data["blocks"] = blocks
                    if result.text.isEmpty {
                        resolve([:])
                    }else{
                        resolve(data)
                    }
                }catch{
                    reject("Error","Processing Image",nil)
                }
            }else{
                reject("Error","Can't Find Photo",nil)
            }
    }
    private func getOrientation(
      orientation: String
    ) -> UIImage.Orientation {
        switch orientation {
        case "portrait":
            return .right
        case "landscapeLeft":
            return .up
        case "portraitUpsideDown":
            return .left
        case "landscapeRight":
            return  .down
        default:
            return .up
        }
    }
}
EOF

# Fix RNVisionCameraOCR.mm - remove requiresMainQueueSetup, add DocumentRecognizerModule
cat > "$LIB_IOS/RNVisionCameraOCR.mm" << 'EOF'
#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>


#if __has_include("RNVisionCameraOCR/RNVisionCameraOCR-Swift.h")
#import "RNVisionCameraOCR/RNVisionCameraOCR-Swift.h"
#else
#import "RNVisionCameraOCR-Swift.h"
#endif

@interface RNVisionCameraOCR (FrameProcessorPluginLoader)
@end

@implementation RNVisionCameraOCR (FrameProcessorPluginLoader)
+ (void) load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"scanText"
    withInitializer:^FrameProcessorPlugin*(VisionCameraProxyHolder* proxy, NSDictionary* options) {
    return [[RNVisionCameraOCR alloc] initWithProxy:proxy withOptions:options];
  }];
}
@end



@interface VisionCameraTranslator (FrameProcessorPluginLoader)
@end

@implementation VisionCameraTranslator (FrameProcessorPluginLoader)
+ (void) load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"translate"
    withInitializer:^FrameProcessorPlugin*(VisionCameraProxyHolder* proxy, NSDictionary* options) {
    return [[VisionCameraTranslator alloc] initWithProxy:proxy withOptions:options];
  }];
}
@end





#import <React/RCTBridgeModule.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(RemoveLanguageModel, NSObject)

RCT_EXTERN_METHOD(remove:(NSString *)code
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(PhotoRecognizerModule, NSObject)

RCT_EXTERN_METHOD(process:(NSString *)uri
                  orientation:(NSString *)orientation
                  withResolver:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(DocumentRecognizerModule, NSObject)

RCT_EXTERN_METHOD(process:(NSString *)uri
                  searchTerms:(NSArray *)searchTerms
                  withResolver:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

@end
EOF

echo "iOS native modules fixed!"
