<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createAccount, type Account, type CreateAccountPayload } from '@/api/accounts'
import { useCloud189QrLogin } from '@/composables/useCloud189QrLogin'

const emit = defineEmits<{ saved: [] }>()

const visible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)

const form = reactive<CreateAccountPayload>({
  cloudType: 'cloud189',
  username: '',
  password: '',
  cookies: '',
  qrLoginId: '',
  alias: '',
  validateCode: '',
  captchaId: '',
  cloudStrmPrefix: '',
  localStrmPrefix: '',
  embyPathReplace: ''
})

const captcha = reactive({ show: false, url: '' })

const {
  qrImage,
  qrStatus,
  active: qrActive,
  loading: qrLoading,
  start: qrStart,
  reset: qrReset
} = useCloud189QrLogin()

const title = computed(() => (isEdit.value ? '修改账号' : '添加账号'))
const isQuark = computed(() => form.cloudType === 'quark')

function resetForm() {
  Object.assign(form, {
    id: undefined,
    cloudType: 'cloud189',
    username: '',
    password: '',
    cookies: '',
    qrLoginId: '',
    alias: '',
    validateCode: '',
    captchaId: '',
    cloudStrmPrefix: '',
    localStrmPrefix: '',
    embyPathReplace: ''
  })
  captcha.show = false
  captcha.url = ''
  qrReset()
}

function open(account?: Account) {
  resetForm()
  if (account) {
    isEdit.value = true
    form.id = account.id
    form.cloudType = account.cloudType
    form.username = account.original_username // 提交用真实用户名
    form.alias = account.alias || ''
    form.cloudStrmPrefix = account.cloudStrmPrefix || ''
    form.localStrmPrefix = account.localStrmPrefix || ''
    form.embyPathReplace = account.embyPathReplace || ''
  } else {
    isEdit.value = false
  }
  visible.value = true
}

defineExpose({ open })

function onStartQr() {
  if (form.cloudType !== 'cloud189') {
    ElMessage.warning('请选择天翼云盘')
    return
  }
  qrStart(async (username, qrLoginId) => {
    form.username = username
    form.qrLoginId = qrLoginId
    qrStatus.value = '扫码成功，正在添加账号'
    await submit()
  })
}

function validate(): string | null {
  if (!form.username && !form.qrLoginId) return '用户名不能为空'
  if (isQuark.value && !form.cookies) return '夸克网盘账号必须填写 Cookie'
  if (form.cloudType === 'cloud189' && !form.id && !form.password && !form.cookies && !form.qrLoginId) {
    return '天翼云盘账号密码、二维码登录和 Cookie 不能同时为空'
  }
  return null
}

async function submit() {
  const err = validate()
  if (err) {
    ElMessage.warning(err)
    return
  }
  submitting.value = true
  try {
    const res = await createAccount({ ...form })
    if (res.success) {
      ElMessage.success(isEdit.value ? '修改成功' : '添加成功')
      visible.value = false
      emit('saved')
      return
    }
    if (res.code === 'NEED_CAPTCHA') {
      captcha.show = true
      captcha.url = res.data?.captchaUrl || ''
      form.captchaId = res.data?.captchaId || ''
      ElMessage.warning('请输入验证码后重新提交')
      return
    }
    ElMessage.error((isEdit.value ? '修改' : '添加') + '失败：' + (res.error || '未知错误'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="560px" @closed="resetForm">
    <el-form label-width="120px" @submit.prevent>
      <el-form-item label="网盘类型">
        <el-select v-model="form.cloudType" :disabled="isEdit" @change="qrReset()">
          <el-option label="天翼云盘" value="cloud189" />
          <el-option label="夸克网盘" value="quark" />
        </el-select>
      </el-form-item>

      <el-form-item label="用户名">
        <el-input v-model="form.username" :readonly="isEdit" placeholder="账号用户名" />
      </el-form-item>

      <el-form-item v-if="!isQuark" label="密码">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          placeholder="天翼云盘密码（填写则优先用账密登录）"
        />
      </el-form-item>

      <el-form-item label="Cookie">
        <el-input
          v-model="form.cookies"
          type="textarea"
          :rows="2"
          :placeholder="isQuark ? '请输入夸克网盘 Cookie（必填）' : '可选'"
        />
      </el-form-item>

      <el-form-item v-if="!isQuark" label="扫码登录">
        <div class="qr-block">
          <el-button :loading="qrLoading" @click="onStartQr">
            {{ qrImage ? '刷新二维码' : '获取二维码' }}
          </el-button>
          <div v-if="qrActive || qrImage" class="qr-body">
            <img v-if="qrImage" :src="qrImage" class="qr-img" alt="天翼云盘二维码" />
            <span class="qr-status">{{ qrStatus }}</span>
          </div>
        </div>
      </el-form-item>

      <el-form-item v-if="captcha.show" label="验证码">
        <div class="captcha-block">
          <img v-if="captcha.url" :src="captcha.url" class="captcha-img" alt="验证码" />
          <el-input v-model="form.validateCode" placeholder="请输入验证码" style="width: 160px" />
        </div>
      </el-form-item>

      <el-divider content-position="left">可选配置</el-divider>

      <el-form-item label="别名">
        <el-input v-model="form.alias" placeholder="便于识别的别名" />
      </el-form-item>
      <el-form-item label="媒体目录前缀">
        <el-input
          v-model="form.cloudStrmPrefix"
          :placeholder="isQuark ? 'http://alist:5244/d/夸克网盘' : 'http://alist:5244/d/云盘'"
        />
      </el-form-item>
      <el-form-item label="本地目录前缀">
        <el-input v-model="form.localStrmPrefix" placeholder="STRM 本地路径前缀" />
      </el-form-item>
      <el-form-item label="Emby路径替换">
        <el-input v-model="form.embyPathReplace" placeholder="Emby 路径替换规则" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">
        {{ isEdit ? '修改' : '添加' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.qr-block {
  width: 100%;
}
.qr-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.qr-img {
  width: 200px;
  height: 200px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}
.qr-status {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.captcha-block {
  display: flex;
  align-items: center;
  gap: 12px;
}
.captcha-img {
  height: 38px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  cursor: pointer;
}
</style>
