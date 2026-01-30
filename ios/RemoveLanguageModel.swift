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





