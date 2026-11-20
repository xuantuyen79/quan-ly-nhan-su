// Feedback uses the existing mail configuration. No employee payload is accepted.
export async function sendKsbFeedback(input, cfg, send = fetch) {
  const fail = (loi, status = 400) => ({status, body:{ok:false,loi}});
  const value = (key, max) => typeof input?.[key] === 'string' ? input[key].trim().slice(0,max) : '';
  const type=value('type',40),content=value('content',3800),name=value('name',120),phone=value('phone',20),email=value('email',160);
  if (!['Đánh giá chung','Đề xuất tính năng','Báo lỗi'].includes(type)) return fail('Loại góp ý chưa hợp lệ.');
  if (content.length<5 || name.length<2) return fail('Nhập nội dung ít nhất 5 ký tự và họ tên ít nhất 2 ký tự.');
  if (email && !/^[^\s@<>,;"\r\n]+@[^\s@<>,;"\r\n]+\.[a-z]{2,}$/i.test(email)) return fail('Email phản hồi chưa hợp lệ.');
  if (!cfg.mail_key || !cfg.mail_from) return fail('Chưa cấu hình gửi email. Quản trị viên vào Cài đặt → Gửi email tự động để thiết lập Resend.',503);
  const msg={from:cfg.mail_name?cfg.mail_name+' <'+cfg.mail_from+'>':cfg.mail_from,to:['info@ksb.vn'],subject:'[QLNS-KSB] '+type,text:['Góp ý phần mềm QLNS-KSB','Loại góp ý: '+type,'Họ tên: '+name,'Số điện thoại: '+(phone||'Không cung cấp'),'Email: '+(email||'Không cung cấp'),'','Nội dung:',content].join('\n')};
  if (email) msg.reply_to=email;
  else if (cfg.mail_reply) msg.reply_to=cfg.mail_reply;
  try {
    const response=await send('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+cfg.mail_key,'content-type':'application/json'},body:JSON.stringify(msg)});
    const result=await response.json().catch(()=>({}));
    if (!response.ok || typeof result.id!=='string' || !result.id) return fail('Dịch vụ email chưa xác nhận gửi góp ý. Vui lòng thử lại hoặc liên hệ quản trị viên.',502);
    return {status:200,body:{ok:true,id:result.id}};
  } catch { return fail('Chưa kết nối được dịch vụ email. Vui lòng thử lại.',502); }
}
